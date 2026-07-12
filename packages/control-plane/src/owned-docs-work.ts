import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase, type DocsAgentDatabase } from "./db/client.js";
import {
  docsSignalArtifacts,
  docsSignalEvents,
  docsSignalOwnedWork,
  docsSignals,
} from "./db/schema.js";
import { docsSignalArtifactInputSchema } from "./docs-signals.js";
import {
  ownedDocsWorkConversationSchema,
  ownedDocsWorkOutcomeSchema,
  ownedDocsWorkRecordSchema,
  ownedDocsWorkReferencesSchema,
  type OwnedDocsWorkRecord,
  type OwnedDocsWorkStatus,
} from "./owned-docs-work-contract.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";
import { createProductRun } from "./product-runs.js";
import { resolveEveRuntimeUrl } from "./provider-config.js";

const nowIso = () => new Date().toISOString();
const operationKeySchema = z.string().trim().min(1).max(500);
const summarySchema = z.string().trim().min(1).max(2_000);
const runtimeSchema = z.object({ sessionId: z.string().min(1), runId: z.string().min(1) });
const updateBase = {
  signalId: z.string().trim().min(1),
  expectedRevision: z.number().int().positive(),
  operationKey: operationKeySchema,
};

export const ownedDocsWorkMilestoneSchema = z.enum([
  "content-plan-shared",
  "approach-changed",
  "validation-complete",
  "draft-ready",
  "approval-requested",
  "publication-complete",
]);

export const startOwnedDocsWorkInputSchema = z.object({
  signalId: z.string().trim().min(1),
  operationKey: operationKeySchema,
  intendedOutcome: summarySchema,
  conversation: ownedDocsWorkConversationSchema,
});

export const updateOwnedDocsWorkInputSchema = z.discriminatedUnion("action", [
  z.object({ ...updateBase, action: z.literal("record"), activityKind: z.enum(["routine", "milestone"]), milestone: ownedDocsWorkMilestoneSchema.optional(), summary: summarySchema, references: ownedDocsWorkReferencesSchema.partial().default({}), artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]) }).superRefine((value, ctx) => {
    if (value.activityKind === "milestone" && value.milestone === undefined) ctx.addIssue({ code: "custom", path: ["milestone"], message: "Milestone activity requires a milestone name." });
    if (value.activityKind === "routine" && value.milestone !== undefined) ctx.addIssue({ code: "custom", path: ["milestone"], message: "Routine activity must not claim a channel milestone." });
  }),
  z.object({ ...updateBase, action: z.literal("park"), reasonKind: z.enum(["missing-evidence", "product-decision", "unrecoverable-failure"]), summary: summarySchema, artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]) }),
  z.object({ ...updateBase, action: z.literal("resume"), summary: summarySchema }),
  z.object({ ...updateBase, action: z.literal("correct"), summary: summarySchema, references: ownedDocsWorkReferencesSchema.partial().default({}) }),
  z.object({ ...updateBase, action: z.literal("pause"), summary: summarySchema }),
  z.object({ ...updateBase, action: z.literal("abandon"), summary: summarySchema }),
  z.object({ ...updateBase, action: z.literal("complete"), outcome: ownedDocsWorkOutcomeSchema.exclude(["abandoned", "failed"]), summary: summarySchema, references: ownedDocsWorkReferencesSchema.partial().default({}), artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]) }),
]);

export const ownedDocsWorkResultSchema = z.object({
  created: z.boolean(),
  replayed: z.boolean(),
  work: ownedDocsWorkRecordSchema,
  channelUpdate: z.string().nullable(),
});

export type OwnedDocsWorkRuntime = z.infer<typeof runtimeSchema>;
type Executor = Pick<DocsAgentDatabase, "select" | "insert" | "update">;

export async function startOwnedDocsWork(
  input: z.infer<typeof startOwnedDocsWorkInputSchema>,
  runtime: OwnedDocsWorkRuntime,
) {
  const parsed = startOwnedDocsWorkInputSchema.parse(input);
  const activeRuntime = runtimeSchema.parse(runtime);
  const result = await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await assertSignalExists(tx, parsed.signalId);
    const existing = await readOwnedWork(tx, parsed.signalId);
    if (existing !== null) {
      const replayed = existing.lastOperationKey === parsed.operationKey;
      return ownedDocsWorkResultSchema.parse({ created: false, replayed, work: existing, channelUpdate: replayed ? null : existing.sessionId === activeRuntime.sessionId ? `Resuming owned documentation work: ${existing.intendedOutcome}` : `Documentation work is already owned in Eve session ${existing.sessionId}; resume that session instead of creating a duplicate.` });
    }
    const createdAt = nowIso();
    const id = `owned:${parsed.signalId}`;
    const insertedRows = await tx.insert(docsSignalOwnedWork).values({ id, signalId: parsed.signalId, workspaceId: DEFAULT_WORKSPACE_ID, status: "active", sessionId: activeRuntime.sessionId, startedRunId: activeRuntime.runId, lastRunId: activeRuntime.runId, conversation: parsed.conversation, intendedOutcome: parsed.intendedOutcome, references: ownedDocsWorkReferencesSchema.parse({}), outcome: null, revision: 1, lastOperationKey: parsed.operationKey, lastMilestone: "accepted", createdAt, updatedAt: createdAt }).onConflictDoNothing({ target: [docsSignalOwnedWork.workspaceId, docsSignalOwnedWork.signalId] }).returning({ id: docsSignalOwnedWork.id });
    if (insertedRows.length === 0) {
      const concurrent = await requireOwnedWork(tx, parsed.signalId);
      const replayed = concurrent.lastOperationKey === parsed.operationKey;
      return ownedDocsWorkResultSchema.parse({ created: false, replayed, work: concurrent, channelUpdate: replayed ? null : `Documentation work is already owned in Eve session ${concurrent.sessionId}; resume that work instead of creating a duplicate.` });
    }
    await touchSignal(tx, parsed.signalId, createdAt);
    await insertOwnedEvent(tx, { signalId: parsed.signalId, eventType: "owned-work-accepted", reason: parsed.intendedOutcome, metadata: { workId: id, operationKey: parsed.operationKey, sessionId: activeRuntime.sessionId, runId: activeRuntime.runId, conversation: parsed.conversation, ownedStatus: "active" } });
    const work = await requireOwnedWork(tx, parsed.signalId);
    return ownedDocsWorkResultSchema.parse({ created: true, replayed: false, work, channelUpdate: `Accepted substantial documentation work: ${parsed.intendedOutcome}` });
  }));
  await recordOwnedProductRun(parsed.operationKey, result.work, activeRuntime);
  return result;
}

export async function getOwnedDocsWork(input: { signalId: string }) {
  const signalId = z.string().trim().min(1).parse(input.signalId);
  return withDocsAgentDatabase(async (db) => requireOwnedWork(db, signalId));
}

export async function updateOwnedDocsWork(
  input: z.infer<typeof updateOwnedDocsWorkInputSchema>,
  runtime: OwnedDocsWorkRuntime,
) {
  const parsed = updateOwnedDocsWorkInputSchema.parse(input);
  const activeRuntime = runtimeSchema.parse(runtime);
  const result = await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const current = await requireOwnedWork(tx, parsed.signalId);
    if (current.sessionId !== activeRuntime.sessionId) throw new Error(`Owned work ${current.id} must resume in Eve session ${current.sessionId}, not ${activeRuntime.sessionId}.`);
    if (current.lastOperationKey === parsed.operationKey) return ownedDocsWorkResultSchema.parse({ created: false, replayed: true, work: current, channelUpdate: null });
    if (current.revision !== parsed.expectedRevision) throw new Error(`Owned work ${current.id} changed concurrently. Expected revision ${parsed.expectedRevision}, found ${current.revision}. Inspect and retry the same work item.`);
    const transition = applyOwnedWorkAction(current, parsed);
    const updatedAt = nowIso();
    const updatedRows = await tx.update(docsSignalOwnedWork).set({ status: transition.status, lastRunId: activeRuntime.runId, references: transition.references, outcome: transition.outcome, revision: current.revision + 1, lastOperationKey: parsed.operationKey, lastMilestone: transition.milestone, updatedAt }).where(and(eq(docsSignalOwnedWork.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsSignalOwnedWork.signalId, parsed.signalId), eq(docsSignalOwnedWork.revision, current.revision))).returning({ id: docsSignalOwnedWork.id });
    if (updatedRows.length !== 1) throw new Error(`Owned work ${current.id} changed while applying ${parsed.action}. Inspect and retry.`);
    await insertOwnedArtifacts(tx, parsed.signalId, "artifacts" in parsed ? parsed.artifacts : []);
    await touchSignal(tx, parsed.signalId, updatedAt);
    await insertOwnedEvent(tx, { signalId: parsed.signalId, eventType: `owned-work-${parsed.action}`, reason: parsed.summary, metadata: { workId: current.id, operationKey: parsed.operationKey, sessionId: activeRuntime.sessionId, runId: activeRuntime.runId, fromOwnedStatus: current.status, toOwnedStatus: transition.status, milestone: transition.milestone, revision: current.revision + 1 } });
    const work = await requireOwnedWork(tx, parsed.signalId);
    return ownedDocsWorkResultSchema.parse({ created: false, replayed: false, work, channelUpdate: transition.channelUpdate });
  }));
  await recordOwnedProductRun(parsed.operationKey, result.work, activeRuntime);
  return result;
}

function applyOwnedWorkAction(current: OwnedDocsWorkRecord, input: z.infer<typeof updateOwnedDocsWorkInputSchema>): { status: OwnedDocsWorkStatus; outcome: OwnedDocsWorkRecord["outcome"]; references: OwnedDocsWorkRecord["references"]; milestone: string | null; channelUpdate: string | null } {
  if (["completed", "blocked", "abandoned", "failed"].includes(current.status)) throw new Error(`Owned work ${current.id} is terminal (${current.status}).`);
  const references = "references" in input ? mergeReferences(current.references, input.references) : current.references;
  switch (input.action) {
    case "record": {
      if (!["active", "draft-ready", "awaiting-approval"].includes(current.status)) throw new Error(`Owned work ${current.id} must resume before recording more activity from ${current.status}.`);
      const status = input.milestone === "draft-ready" ? "draft-ready" : input.milestone === "approval-requested" ? "awaiting-approval" : current.status === "awaiting-approval" ? "awaiting-approval" : current.status === "draft-ready" && input.milestone === "validation-complete" ? "draft-ready" : "active";
      return { status, outcome: null, references, milestone: input.milestone ?? current.lastMilestone, channelUpdate: input.activityKind === "routine" ? null : input.summary };
    }
    case "park": return input.reasonKind === "unrecoverable-failure" ? { status: "failed", outcome: "failed", references, milestone: "failed", channelUpdate: input.summary } : { status: "parked", outcome: null, references, milestone: "parked", channelUpdate: input.summary };
    case "resume":
      if (!["parked", "paused", "awaiting-approval"].includes(current.status)) throw new Error(`Owned work ${current.id} cannot resume from ${current.status}.`);
      return { status: "active", outcome: null, references, milestone: "resumed", channelUpdate: input.summary };
    case "correct": return { status: "active", outcome: null, references, milestone: "approach-changed", channelUpdate: input.summary };
    case "pause": return { status: "paused", outcome: null, references, milestone: "paused", channelUpdate: input.summary };
    case "abandon": return { status: "abandoned", outcome: "abandoned", references, milestone: "abandoned", channelUpdate: input.summary };
    case "complete": return { status: input.outcome === "blocked" ? "blocked" : "completed", outcome: input.outcome, references, milestone: "completed", channelUpdate: input.summary };
  }
}

function mergeReferences(current: OwnedDocsWorkRecord["references"], update: Partial<OwnedDocsWorkRecord["references"]>) {
  return ownedDocsWorkReferencesSchema.parse({ ...current, ...update, validationArtifactIds: [...new Set([...(current.validationArtifactIds ?? []), ...(update.validationArtifactIds ?? [])])] });
}

async function assertSignalExists(db: Executor, signalId: string) {
  const rows = await db.select({ id: docsSignals.id }).from(docsSignals).where(and(eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsSignals.id, signalId))).limit(1);
  if (rows.length !== 1) throw new Error(`Docs signal not found: ${signalId}`);
}
async function readOwnedWork(db: Executor, signalId: string) {
  const rows = await db.select().from(docsSignalOwnedWork).where(and(eq(docsSignalOwnedWork.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsSignalOwnedWork.signalId, signalId))).limit(1);
  return rows[0] === undefined ? null : ownedDocsWorkRecordSchema.parse(rows[0]);
}
async function requireOwnedWork(db: Executor, signalId: string) {
  const work = await readOwnedWork(db, signalId);
  if (work === null) throw new Error(`Owned documentation work not found for signal: ${signalId}`);
  return work;
}
async function touchSignal(db: Executor, signalId: string, updatedAt: string) { await db.update(docsSignals).set({ updatedAt }).where(and(eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsSignals.id, signalId))); }
async function insertOwnedArtifacts(db: Executor, signalId: string, artifacts: z.infer<typeof docsSignalArtifactInputSchema>[]) { if (artifacts.length === 0) return; await db.insert(docsSignalArtifacts).values(artifacts.map((artifact) => ({ id: randomUUID(), signalId, workspaceId: DEFAULT_WORKSPACE_ID, kind: artifact.kind, label: artifact.label ?? null, url: artifact.url ?? null, path: artifact.path ?? null, metadata: artifact.metadata, createdAt: nowIso() }))); }
async function insertOwnedEvent(db: Executor, event: { signalId: string; eventType: string; reason: string; metadata: Record<string, unknown> }) { await db.insert(docsSignalEvents).values({ id: randomUUID(), signalId: event.signalId, workspaceId: DEFAULT_WORKSPACE_ID, eventType: event.eventType, fromStatus: null, toStatus: null, reason: event.reason, actor: "docs-agent:owned-work", metadata: event.metadata, createdAt: nowIso() }); }

async function recordOwnedProductRun(
  operationKey: string,
  work: OwnedDocsWorkRecord,
  runtime: OwnedDocsWorkRuntime,
): Promise<void> {
  const runtimeUrl = resolveEveRuntimeUrl().replace(/\/$/, "");
  await createProductRun({
    operationKey: `owned-docs-work:${work.signalId}:${operationKey}`,
    runType: "owned-docs-work",
    trigger: ownedTrigger(work.conversation.kind),
    sessionId: runtime.sessionId,
    runId: runtime.runId,
    signalId: work.signalId,
    workflowId: work.id,
    traceLinks: [{
      kind: "eve",
      label: "Durable Eve event stream",
      url: `${runtimeUrl}/eve/v1/session/${encodeURIComponent(runtime.sessionId)}/stream`,
      availability: "available",
    }],
  });
}

function ownedTrigger(kind: OwnedDocsWorkRecord["conversation"]["kind"]) {
  if (kind === "slack-thread") return "slack" as const;
  if (kind === "linear-issue") return "linear" as const;
  if (kind === "terminal") return "terminal" as const;
  if (kind === "web") return "web" as const;
  return "other" as const;
}
