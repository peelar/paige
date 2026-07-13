import { randomUUID } from "node:crypto";

import { getVercelOidcToken } from "@vercel/oidc";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import { approvalDecisions, approvalRequests, docsSignals } from "./db/schema.ts";
import { getOperatorSignalDetail, redactMetadata } from "./signal-detail.ts";
import { createProductRun } from "./product-runs.ts";
import { resolveEveRuntimeUrl } from "./provider-config.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";

const APPROVAL_RETENTION_DAYS = 7;
const text = z.string().trim().min(1);
const iso = z.string().datetime({ offset: true });
const safePublishInputSchema = z.object({
  baseBranch: z.string().trim().min(1).max(160).optional(),
  branchName: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(2_000).optional(),
  commitMessage: z.string().trim().min(1).max(2_000).optional(),
  signalId: z.string().trim().min(1).max(500).optional(),
});

export const approvalRequestStatusSchema = z.enum(["pending", "deciding", "approved", "denied", "failed", "stale"]);
export const approvalDisplayStateSchema = z.enum([...approvalRequestStatusSchema.options, "expired"]);
export const approvalDecisionSchema = z.enum(["approve", "deny"]);
export const approvalAuditActorSchema = z.object({ id: text.max(500), login: text.max(200) });

const eveRequestSchema = z.object({
  requestId: text,
  display: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()).optional(),
  action: z.object({ kind: z.literal("tool-call"), callId: text, toolName: text, input: z.record(z.string(), z.unknown()) }),
}).passthrough();

export const recordApprovalBatchInputSchema = z.object({
  sessionId: text,
  runId: text,
  continuationToken: text,
  trigger: z.enum(["slack", "linear", "schedule", "terminal", "web", "other"]),
  requester: text.max(500),
  destination: z.string().max(1_000).optional(),
  requestedAt: iso.optional(),
  requests: z.array(eveRequestSchema).max(20),
});

export const approvalListItemSchema = z.object({
  id: z.string(), requestId: z.string(), productRunId: z.string(), sessionId: z.string(), runId: z.string(),
  status: approvalRequestStatusSchema, displayState: approvalDisplayStateSchema, toolName: z.string(), action: z.string(),
  destination: z.string().nullable(), requester: z.string(), signal: z.object({ id: z.string(), summary: z.string() }).nullable(),
  requestedAt: z.string(), expiresAt: z.string(), decidedAt: z.string().nullable(), updatedAt: z.string(),
});

export const approvalDecisionAuditSchema = z.object({
  id: z.string(), decision: approvalDecisionSchema, reason: z.string(), actorId: z.string(), actorLogin: z.string(),
  status: z.enum(["submitting", "submitted", "failed"]), failureSummary: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});

export const approvalDetailSchema = approvalListItemSchema.extend({
  exactSideEffect: safePublishInputSchema,
  evidence: z.object({ report: z.record(z.string(), z.unknown()).nullable(), diff: z.record(z.string(), z.unknown()).nullable(), checks: z.record(z.string(), z.unknown()).nullable() }),
  decisions: z.array(approvalDecisionAuditSchema),
});

export const decideApprovalInputSchema = z.object({
  id: text,
  decision: approvalDecisionSchema,
  reason: text.max(2_000),
  idempotencyKey: text.max(500),
  actor: approvalAuditActorSchema,
});

export type ApprovalListItem = z.infer<typeof approvalListItemSchema>;
export type ApprovalDetail = z.infer<typeof approvalDetailSchema>;
export type ApprovalRuntime = {
  readEvents(sessionId: string): Promise<unknown[]>;
  resume(input: { sessionId: string; continuationToken: string; requestId: string; decision: "approve" | "deny" }): Promise<void>;
};

export class ApprovalInboxError extends Error {
  readonly code: "not-found" | "expired" | "already-answered" | "stale" | "runtime-unavailable" | "conflict";

  constructor(code: ApprovalInboxError["code"], message: string) {
    super(message);
    this.name = "ApprovalInboxError";
    this.code = code;
  }
}

export async function recordApprovalBatch(input: z.input<typeof recordApprovalBatchInputSchema>) {
  const parsed = recordApprovalBatchInputSchema.parse(input);
  const approvals = parsed.requests.filter(isApprovalRequest);
  const recorded: ApprovalListItem[] = [];
  for (const request of approvals) {
    const safeInput = request.action.toolName === "publish_working_repository_pr" ? safePublishInputSchema.parse(request.action.input) : {};
    const signalId = typeof safeInput.signalId === "string" ? safeInput.signalId : undefined;
    const product = await createProductRun({
      operationKey: `approval:${request.requestId}`,
      runType: request.action.toolName === "publish_working_repository_pr" ? "writeback" : "owned-docs-work",
      trigger: parsed.trigger,
      sessionId: parsed.sessionId,
      runId: parsed.runId,
      signalId,
      startedAt: parsed.requestedAt,
      traceLinks: [{ kind: "eve", label: "Durable Eve event stream", url: `${resolveEveRuntimeUrl().replace(/\/$/, "")}/eve/v1/session/${encodeURIComponent(parsed.sessionId)}/stream`, availability: "available" }],
    });
    const requestedAt = parsed.requestedAt ?? new Date().toISOString();
    await withDocsAgentDatabase(async (db) => {
      await db.insert(approvalRequests).values({
        id: request.requestId, workspaceId: DEFAULT_WORKSPACE_ID, productRunId: product.run.id, signalId: signalId ?? null,
        sessionId: parsed.sessionId, runId: parsed.runId, requestId: request.requestId, callId: request.action.callId,
        toolName: request.action.toolName, status: "pending", action: actionLabel(request.action.toolName), destination: parsed.destination ?? null,
        requester: parsed.requester, safeInput, resumeHandle: parsed.continuationToken, requestedAt,
        expiresAt: addDays(requestedAt, APPROVAL_RETENTION_DAYS), decidedAt: null, updatedAt: requestedAt,
      }).onConflictDoUpdate({ target: [approvalRequests.workspaceId, approvalRequests.requestId], set: {
        productRunId: product.run.id, signalId: signalId ?? null, sessionId: parsed.sessionId, runId: parsed.runId,
        callId: request.action.callId, toolName: request.action.toolName, action: actionLabel(request.action.toolName), destination: parsed.destination ?? null,
        requester: parsed.requester, safeInput, resumeHandle: parsed.continuationToken, updatedAt: requestedAt,
      }, where: eq(approvalRequests.status, "pending") });
    });
    recorded.push(await getApprovalListItem(request.requestId));
  }
  return recorded;
}

export async function listApprovals(input: { now?: string; states?: string[] } = {}) {
  const now = input.now ?? new Date().toISOString();
  const states = input.states === undefined ? undefined : z.array(approvalDisplayStateSchema).parse(input.states);
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.select({ request: approvalRequests, signalSummary: docsSignals.sourceSummary }).from(approvalRequests)
      .leftJoin(docsSignals, eq(approvalRequests.signalId, docsSignals.id))
      .where(eq(approvalRequests.workspaceId, DEFAULT_WORKSPACE_ID)).orderBy(desc(approvalRequests.requestedAt));
    return rows.map((row) => projectList(row.request, row.signalSummary, now)).filter((item) => states === undefined || states.includes(item.displayState));
  });
}

export async function getApprovalDetail(input: { id: string; now?: string }) {
  const id = text.parse(input.id);
  const base = await getApprovalListItem(id, input.now);
  const row = await withDocsAgentDatabase(async (db) => {
    const requests = await db.select().from(approvalRequests).where(and(eq(approvalRequests.workspaceId, DEFAULT_WORKSPACE_ID), eq(approvalRequests.id, id))).limit(1);
    const decisions = await db.select().from(approvalDecisions).where(eq(approvalDecisions.approvalRequestId, id)).orderBy(asc(approvalDecisions.createdAt));
    return { request: requests[0], decisions };
  });
  if (row.request === undefined) throw new ApprovalInboxError("not-found", `Approval request not found: ${id}`);
  let evidence = { report: null as Record<string, unknown> | null, diff: null as Record<string, unknown> | null, checks: null as Record<string, unknown> | null };
  if (row.request.signalId !== null) {
    const signal = await getOperatorSignalDetail({ id: row.request.signalId });
    evidence = {
      report: artifactMetadata(signal.artifacts, "verification-report"),
      diff: artifactMetadata(signal.artifacts, "diff"),
      checks: artifactMetadata(signal.artifacts, "check-log"),
    };
  }
  return approvalDetailSchema.parse({ ...base, exactSideEffect: safePublishInputSchema.parse(row.request.safeInput), evidence, decisions: row.decisions });
}

export async function decideApproval(input: z.input<typeof decideApprovalInputSchema>, runtime: ApprovalRuntime = defaultApprovalRuntime()) {
  const parsed = decideApprovalInputSchema.parse(input);
  const existing = await readDecisionByKey(parsed.idempotencyKey);
  if (existing !== null) return { replayed: true, decision: approvalDecisionAuditSchema.parse(existing), approval: await getApprovalListItem(existing.approvalRequestId) };
  const request = await requireRequest(parsed.id);
  const now = new Date().toISOString();
  if (request.expiresAt <= now) throw new ApprovalInboxError("expired", "This approval request has expired.");
  if (!["pending", "deciding"].includes(request.status)) throw new ApprovalInboxError("already-answered", `This approval request is already ${request.status}.`);
  if (request.resumeHandle === null) throw new ApprovalInboxError("stale", "The original Eve continuation is no longer available.");

  let events: unknown[];
  try { events = await runtime.readEvents(request.sessionId); }
  catch { throw new ApprovalInboxError("runtime-unavailable", "The Eve session could not be re-read before deciding."); }
  const pending = inspectPending(events, request.requestId, request.callId);
  if (pending === "missing") { await markRequest(request.id, "stale", now); throw new ApprovalInboxError("stale", "The pending Eve input request is no longer present."); }
  if (pending === "answered") { await markRequest(request.id, "stale", now); throw new ApprovalInboxError("already-answered", "The Eve input request was already answered through another channel."); }

  const audit = await lockDecision(request.id, parsed, now);
  try {
    await runtime.resume({ sessionId: request.sessionId, continuationToken: request.resumeHandle, requestId: request.requestId, decision: parsed.decision });
  } catch {
    await finishDecision(audit.id, request.id, "failed", "Eve did not accept the approval response.", null);
    throw new ApprovalInboxError("runtime-unavailable", "Eve did not accept the approval response; the request remains pending.");
  }
  const finished = await finishDecision(audit.id, request.id, "submitted", null, parsed.decision === "approve" ? "approved" : "denied");
  return { replayed: false, decision: finished, approval: await getApprovalListItem(request.id) };
}

export async function markApprovalAnsweredByCall(input: { sessionId: string; runId: string; callId: string }) {
  const parsed = z.object({ sessionId: text, runId: text, callId: text }).parse(input);
  const now = new Date().toISOString();
  return withDocsAgentDatabase((db) => db.update(approvalRequests).set({ status: "stale", resumeHandle: null, updatedAt: now })
    .where(and(eq(approvalRequests.workspaceId, DEFAULT_WORKSPACE_ID), eq(approvalRequests.sessionId, parsed.sessionId), eq(approvalRequests.runId, parsed.runId), eq(approvalRequests.callId, parsed.callId), eq(approvalRequests.status, "pending"))));
}

export async function failApprovalsForRunReference(input: { sessionId: string; runId: string }) {
  const parsed = z.object({ sessionId: text, runId: text }).parse(input);
  const now = new Date().toISOString();
  return withDocsAgentDatabase((db) => db.update(approvalRequests).set({ status: "failed", resumeHandle: null, updatedAt: now })
    .where(and(eq(approvalRequests.workspaceId, DEFAULT_WORKSPACE_ID), eq(approvalRequests.sessionId, parsed.sessionId), eq(approvalRequests.runId, parsed.runId), eq(approvalRequests.status, "pending"))));
}

async function getApprovalListItem(id: string, now = new Date().toISOString()) { const request = await requireRequest(id); const signalSummary = request.signalId === null ? null : (await withDocsAgentDatabase(async (db) => (await db.select({ summary: docsSignals.sourceSummary }).from(docsSignals).where(eq(docsSignals.id, request.signalId!)).limit(1))[0]?.summary ?? null)); return projectList(request, signalSummary, now); }
async function requireRequest(id: string) { return withDocsAgentDatabase(async (db) => { const rows = await db.select().from(approvalRequests).where(and(eq(approvalRequests.workspaceId, DEFAULT_WORKSPACE_ID), eq(approvalRequests.id, id))).limit(1); if (rows[0] === undefined) throw new ApprovalInboxError("not-found", `Approval request not found: ${id}`); return rows[0]; }); }
function projectList(request: typeof approvalRequests.$inferSelect, signalSummary: string | null, now: string) { return approvalListItemSchema.parse({ id: request.id, requestId: request.requestId, productRunId: request.productRunId, sessionId: request.sessionId, runId: request.runId, status: request.status, displayState: request.status === "pending" && request.expiresAt <= now ? "expired" : request.status, toolName: request.toolName, action: request.action, destination: request.destination, requester: request.requester, signal: request.signalId === null ? null : { id: request.signalId, summary: signalSummary ?? "Related signal unavailable" }, requestedAt: request.requestedAt, expiresAt: request.expiresAt, decidedAt: request.decidedAt, updatedAt: request.updatedAt }); }
async function readDecisionByKey(key: string) { return withDocsAgentDatabase(async (db) => (await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.workspaceId, DEFAULT_WORKSPACE_ID), eq(approvalDecisions.idempotencyKey, key))).limit(1))[0] ?? null); }
async function markRequest(id: string, status: "stale", now: string) { await withDocsAgentDatabase((db) => db.update(approvalRequests).set({ status, resumeHandle: null, updatedAt: now }).where(eq(approvalRequests.id, id))); }
async function lockDecision(requestId: string, input: z.output<typeof decideApprovalInputSchema>, now: string) { return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => { const id = randomUUID(); const locked = await tx.update(approvalRequests).set({ status: "deciding", updatedAt: now }).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, "pending"))).returning({ id: approvalRequests.id }); if (locked.length !== 1) throw new ApprovalInboxError("conflict", "Another decision is already in progress."); await tx.insert(approvalDecisions).values({ id, workspaceId: DEFAULT_WORKSPACE_ID, approvalRequestId: requestId, idempotencyKey: input.idempotencyKey, decision: input.decision, reason: input.reason, actorId: input.actor.id, actorLogin: input.actor.login, status: "submitting", failureSummary: null, createdAt: now, updatedAt: now }); return approvalDecisionAuditSchema.parse({ id, decision: input.decision, reason: input.reason, actorId: input.actor.id, actorLogin: input.actor.login, status: "submitting", failureSummary: null, createdAt: now, updatedAt: now }); })); }
async function finishDecision(decisionId: string, requestId: string, status: "submitted" | "failed", failureSummary: string | null, requestStatus: "approved" | "denied" | null) { const now = new Date().toISOString(); return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => { await tx.update(approvalDecisions).set({ status, failureSummary, updatedAt: now }).where(eq(approvalDecisions.id, decisionId)); await tx.update(approvalRequests).set(requestStatus === null ? { status: "pending", updatedAt: now } : { status: requestStatus, resumeHandle: null, decidedAt: now, updatedAt: now }).where(eq(approvalRequests.id, requestId)); const rows = await tx.select().from(approvalDecisions).where(eq(approvalDecisions.id, decisionId)).limit(1); return approvalDecisionAuditSchema.parse(rows[0]); })); }

function isApprovalRequest(request: z.infer<typeof eveRequestSchema>) { const optionIds = new Set(request.options?.map((option) => option.id)); return request.display === "confirmation" && optionIds.has("approve") && optionIds.has("deny"); }
function actionLabel(toolName: string) { return toolName === "publish_working_repository_pr" ? "Open a GitHub draft pull request" : `Run ${toolName.replaceAll("_", " ")}`; }
function artifactMetadata(artifacts: Awaited<ReturnType<typeof getOperatorSignalDetail>>["artifacts"], kind: string) { const artifact = [...artifacts].reverse().find((item) => item.kind === kind); return artifact === undefined ? null : redactMetadata(artifact.metadata); }
function addDays(value: string, days: number) { return new Date(new Date(value).getTime() + days * 86_400_000).toISOString(); }
function inspectPending(events: unknown[], requestId: string, callId: string): "pending" | "missing" | "answered" { let requestIndex = -1; for (const [index, event] of events.entries()) { const row = record(event); const data = record(row.data); if (row.type === "input.requested" && Array.isArray(data.requests) && data.requests.some((request) => record(request).requestId === requestId)) requestIndex = index; if (requestIndex >= 0 && index > requestIndex && row.type === "action.result" && nestedCallId(data) === callId) return "answered"; } return requestIndex >= 0 ? "pending" : "missing"; }
function nestedCallId(data: Record<string, unknown>) { const result = record(data.result); return typeof result.callId === "string" ? result.callId : typeof record(result.result).callId === "string" ? String(record(result.result).callId) : undefined; }
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function defaultApprovalRuntime(): ApprovalRuntime { return { readEvents: readEveEvents, async resume(input) { const url = new URL(`/eve/v1/session/${encodeURIComponent(input.sessionId)}`, resolveEveRuntimeUrl()); const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(await eveAuthHeaders()) }, body: JSON.stringify({ continuationToken: input.continuationToken, inputResponses: [{ requestId: input.requestId, optionId: input.decision }] }), redirect: "error", signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error(`Eve resume returned ${response.status}.`); } }; }
async function readEveEvents(sessionId: string) { const url = new URL(`/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`, resolveEveRuntimeUrl()); const response = await fetch(url, { headers: await eveAuthHeaders(), redirect: "error", signal: AbortSignal.timeout(10_000) }); if (!response.ok || response.body === null) throw new Error(`Eve stream returned ${response.status}.`); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; const events: unknown[] = []; while (true) { const read = await Promise.race([reader.read(), new Promise<"idle">((resolve) => setTimeout(() => resolve("idle"), 1_000))]); if (read === "idle") { await reader.cancel(); break; } if (read.done) break; buffer += decoder.decode(read.value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) if (line.trim() !== "") events.push(JSON.parse(line)); } return events; }
async function eveAuthHeaders(): Promise<Record<string, string>> { if (!process.env.VERCEL) return {}; const token = await getVercelOidcToken(); return { authorization: `Bearer ${token}`, "x-vercel-oidc-token": token }; }
