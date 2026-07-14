import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { createDocsSignal } from "../src/docs-signals.ts";
import { ApprovalInboxError, decideApproval, failApprovalsForRunReference, getApprovalDetail, hasApprovedToolResume, listApprovals, markApprovalAnsweredByCall, recordApprovalBatch, type ApprovalRuntime } from "../src/approval-inbox.ts";
import { test } from "vitest";

test("approval inbox", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-approvals-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "approvals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();
  const signal = await createDocsSignal({
    source: { kind: "linear-issue", authors: [], capturedAt: "2026-07-11T08:00:00.000Z", metadata: {} },
    sourceSummary: "Publish the checked metadata guide.", extractedClaims: [], likelyDocsConcepts: [], likelyDocsPages: [], productSurfaces: [], missingEvidence: [], priority: 80,
    links: [], artifacts: [
      { kind: "verification-report", metadata: { decision: "docs-patch", credential: "ghp_secret" } },
      { kind: "diff", metadata: { changedFiles: ["docs/metadata.mdx"] } },
      { kind: "check-log", metadata: { checks: [{ name: "pnpm check", status: "passed" }] } },
    ],
  });
  const request = approvalRequest("request-approve", signal.signal.id);
  const recorded = await recordApprovalBatch({ sessionId: "session-approval", runId: "turn_0", continuationToken: "eve:private-resume-handle", trigger: "linear", requester: "linear:user-101", destination: "https://github.com/example/docs", requestedAt: "2026-07-11T10:00:00.000Z", requests: [request] });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.action, "Open a GitHub draft pull request");
  assert.equal(recorded[0]?.destination, "https://github.com/example/docs");
  assert.equal(recorded[0]?.requester, "linear:user-101");
  assert.equal((await listApprovals({ states: ["pending"] })).length, 1);

  let detail = await getApprovalDetail({ id: "request-approve" });
  assert.equal(detail.signal?.summary, "Publish the checked metadata guide.");
  assert.deepEqual(detail.exactSideEffect, { baseBranch: "main", title: "Document metadata permissions", signalId: signal.signal.id });
  assert.deepEqual(detail.evidence.diff, { changedFiles: ["docs/metadata.mdx"] });
  assert.deepEqual(detail.evidence.checks, { checks: [{ name: "pnpm check", status: "passed" }] });
  assert.equal(detail.evidence.report?.credential, "[redacted]");
  assert.doesNotMatch(JSON.stringify(detail), /private-resume-handle|browserToken|ghp_secret/);

  const resumed: unknown[] = [];
  let decidingResumeAuthorized = false;
  const runtime: ApprovalRuntime = {
    readEvents: async () => [inputEvent(request)],
    resume: async (input) => {
      resumed.push(input);
      decidingResumeAuthorized = await hasApprovedToolResume({
        sessionId: "session-approval",
        runId: "turn_0",
        callId: request.action.callId,
        toolName: request.action.toolName,
      });
    },
  };
  const approved = await decideApproval({ id: request.requestId, decision: "approve", reason: "The report, diff, and checks are ready.", idempotencyKey: "decision-approve-1", actor: { id: "docs-agent:github:1001", login: "operator" } }, runtime);
  assert.equal(approved.replayed, false);
  assert.equal(approved.approval.status, "approved");
  assert.equal(decidingResumeAuthorized, true, "the deciding/submitting resume race is authorized");
  assert.equal(await hasApprovedToolResume({ sessionId: "session-approval", runId: "turn_0", callId: request.action.callId, toolName: request.action.toolName }), true);
  assert.equal(await hasApprovedToolResume({ sessionId: "session-approval", runId: "turn_0", callId: "wrong-call", toolName: request.action.toolName }), false);
  assert.deepEqual(resumed, [{ sessionId: "session-approval", continuationToken: "eve:private-resume-handle", requestId: request.requestId, decision: "approve" }]);
  const replay = await decideApproval({ id: request.requestId, decision: "approve", reason: "Ignored replay reason.", idempotencyKey: "decision-approve-1", actor: { id: "docs-agent:github:1001", login: "operator" } }, runtime);
  assert.equal(replay.replayed, true);
  assert.equal(resumed.length, 1);
  await assert.rejects(() => decideApproval({ id: request.requestId, decision: "deny", reason: "Too late.", idempotencyKey: "decision-second", actor: { id: "docs-agent:github:1001", login: "operator" } }, runtime), (error) => error instanceof ApprovalInboxError && error.code === "already-answered");

  const deniedRequest = approvalRequest("request-deny", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-deny", runId: "turn_0", continuationToken: "eve:deny-handle", trigger: "slack", requester: "slack:user-202", requestedAt: "2026-07-11T11:00:00.000Z", requests: [deniedRequest] });
  const denied = await decideApproval({ id: deniedRequest.requestId, decision: "deny", reason: "The diff needs another review.", idempotencyKey: "decision-deny-1", actor: { id: "docs-agent:github:1001", login: "operator" } }, runtimeFor(deniedRequest, resumed));
  assert.equal(denied.approval.status, "denied");

  const scheduleRequest = approvalRequest("request-schedule", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-schedule", runId: "turn_0", continuationToken: "eve:schedule", trigger: "schedule", requester: "eve:app", requestedAt: "2026-07-11T11:15:00.000Z", requests: [scheduleRequest] });
  await decideApproval({ id: scheduleRequest.requestId, decision: "approve", reason: "Exercise the negative schedule boundary.", idempotencyKey: "decision-schedule-1", actor: { id: "docs-agent:github:1001", login: "operator" } }, runtimeFor(scheduleRequest, resumed));
  assert.equal(await hasApprovedToolResume({ sessionId: "session-schedule", runId: "turn_0", callId: scheduleRequest.action.callId, toolName: scheduleRequest.action.toolName }), false, "an approved schedule row cannot resume publication");

  const nativeRequest = approvalRequest("request-channel-native", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-native", runId: "turn_0", continuationToken: "eve:native", trigger: "slack", requester: "slack:user", requestedAt: "2026-07-11T11:30:00.000Z", requests: [nativeRequest] });
  await markApprovalAnsweredByCall({ sessionId: "session-native", runId: "turn_0", callId: nativeRequest.action.callId });
  assert.equal((await getApprovalDetail({ id: nativeRequest.requestId })).status, "stale");

  const terminalFailureRequest = approvalRequest("request-terminal-failure", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-terminal-failure", runId: "turn_0", continuationToken: "eve:terminal-failure", trigger: "linear", requester: "linear:user", requestedAt: "2026-07-11T11:45:00.000Z", requests: [terminalFailureRequest] });
  await failApprovalsForRunReference({ sessionId: "session-terminal-failure", runId: "turn_0" });
  assert.equal((await getApprovalDetail({ id: terminalFailureRequest.requestId })).status, "failed");

  await assert.rejects(() => decideApproval({ id: deniedRequest.requestId, decision: "approve", reason: "Missing actor.", idempotencyKey: "unauthorized-shape", actor: {} as never }, runtime), /Too small|expected string/i);

  const staleRequest = approvalRequest("request-stale", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-stale", runId: "turn_0", continuationToken: "eve:stale", trigger: "web", requester: "web:user", requestedAt: "2026-07-11T12:00:00.000Z", requests: [staleRequest] });
  await assert.rejects(() => decideApproval({ id: staleRequest.requestId, decision: "approve", reason: "Try stale.", idempotencyKey: "stale-decision", actor: { id: "operator", login: "operator" } }, { readEvents: async () => [], resume: async () => {} }), (error) => error instanceof ApprovalInboxError && error.code === "stale");

  const answeredRequest = approvalRequest("request-answered", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-answered", runId: "turn_0", continuationToken: "eve:answered", trigger: "terminal", requester: "terminal:user", requestedAt: "2026-07-11T13:00:00.000Z", requests: [answeredRequest] });
  await assert.rejects(() => decideApproval({ id: answeredRequest.requestId, decision: "approve", reason: "Duplicate channel response.", idempotencyKey: "answered-decision", actor: { id: "operator", login: "operator" } }, { readEvents: async () => [inputEvent(answeredRequest), { type: "action.result", data: { result: { callId: answeredRequest.action.callId } } }], resume: async () => {} }), (error) => error instanceof ApprovalInboxError && error.code === "already-answered");

  const failedRequest = approvalRequest("request-failed-resume", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-failed", runId: "turn_0", continuationToken: "eve:failed", trigger: "terminal", requester: "terminal:user", requestedAt: "2026-07-11T14:00:00.000Z", requests: [failedRequest] });
  await assert.rejects(() => decideApproval({ id: failedRequest.requestId, decision: "approve", reason: "Runtime is down.", idempotencyKey: "failed-decision", actor: { id: "operator", login: "operator" } }, { readEvents: async () => [inputEvent(failedRequest)], resume: async () => { throw new Error("offline"); } }), (error) => error instanceof ApprovalInboxError && error.code === "runtime-unavailable");
  detail = await getApprovalDetail({ id: failedRequest.requestId });
  assert.equal(detail.status, "pending");
  assert.equal(detail.decisions.at(-1)?.status, "failed");
  assert.doesNotMatch(JSON.stringify(detail.decisions), /eve:failed/);

  const expiredRequest = approvalRequest("request-expired", signal.signal.id);
  await recordApprovalBatch({ sessionId: "session-expired", runId: "turn_0", continuationToken: "eve:expired", trigger: "other", requester: "old:user", requestedAt: "2026-06-01T00:00:00.000Z", requests: [expiredRequest] });
  assert.equal((await listApprovals({ now: "2026-07-12T00:00:00.000Z", states: ["expired"] })).length, 1);
  await assert.rejects(() => decideApproval({ id: expiredRequest.requestId, decision: "approve", reason: "Expired.", idempotencyKey: "expired-decision", actor: { id: "operator", login: "operator" } }, runtimeFor(expiredRequest, resumed)), (error) => error instanceof ApprovalInboxError && error.code === "expired");
} finally {
  restore("DOCS_AGENT_DATABASE_URL", originalUrl); restore("VERCEL", originalVercel); restore("NODE_ENV", originalNodeEnv); await rm(root, { recursive: true, force: true });
}

console.log("Approval inbox checks passed.");

function approvalRequest(requestId: string, signalId: string) { return { requestId, display: "confirmation", prompt: "Approve this tool call?", options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }], action: { kind: "tool-call" as const, callId: `call-${requestId}`, toolName: "publish_working_repository_pr", input: { baseBranch: "main", title: "Document metadata permissions", signalId, browserToken: "ghp_secret" } } }; }
function inputEvent(request: ReturnType<typeof approvalRequest>) { return { type: "input.requested", data: { requests: [request] } }; }
function runtimeFor(request: ReturnType<typeof approvalRequest>, resumed: unknown[]): ApprovalRuntime { return { readEvents: async () => [inputEvent(request)], resume: async (input) => { resumed.push(input); } }; }
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
