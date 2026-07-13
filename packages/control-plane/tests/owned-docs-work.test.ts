import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { createDocsSignal, getDocsSignal } from "../src/docs-signals.ts";
import { getOwnedDocsWork, startOwnedDocsWork, updateOwnedDocsWork } from "../src/owned-docs-work.ts";
import { test } from "vitest";

test("owned docs work", async () => {
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-owned-work-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "owned.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const runtime = { sessionId: "eve-session-owned-1", runId: "eve-run-start" };

try {
  await migrateDocsAgentDatabase();
  const signalId = await createSignal("owned-main");
  const started = await startOwnedDocsWork({ signalId, operationKey: "accept-owned-main", intendedOutcome: "Deliver a checked multi-page migration guide.", conversation: { kind: "linear-issue", id: "DOCS-56", url: "https://linear.app/acme/issue/DOCS-56" } }, runtime);
  assert.equal(started.created, true);
  assert.equal(started.work.revision, 1);
  assert.match(started.channelUpdate ?? "", /Accepted substantial documentation work/);

  const duplicate = await startOwnedDocsWork({ signalId, operationKey: "accept-owned-main", intendedOutcome: "Deliver a checked multi-page migration guide.", conversation: { kind: "linear-issue", id: "DOCS-56" } }, runtime);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.work.id, started.work.id);
  assert.equal(duplicate.channelUpdate, null);
  const otherSession = await startOwnedDocsWork({ signalId, operationKey: "another-start", intendedOutcome: "Duplicate attempt.", conversation: { kind: "web", id: "signal-detail" } }, { sessionId: "different-session", runId: "different-run" });
  assert.equal(otherSession.work.id, started.work.id);
  assert.match(otherSession.channelUpdate ?? "", /eve-session-owned-1/);

  const routine = await updateOwnedDocsWork({ signalId, expectedRevision: 1, operationKey: "inspect-repository", action: "record", activityKind: "routine", summary: "Inspected navigation and nearby guides.", references: { impactReportId: "impact-56" }, artifacts: [{ kind: "impact-report", label: "Docs impact", metadata: { decision: "docs-patch" } }] }, { ...runtime, runId: "eve-run-investigate" });
  assert.equal(routine.work.revision, 2);
  assert.equal(routine.channelUpdate, null, "routine activity stays out of the channel");
  const replayedRoutine = await updateOwnedDocsWork({ signalId, expectedRevision: 1, operationKey: "inspect-repository", action: "record", activityKind: "routine", summary: "Would duplicate activity.", references: {}, artifacts: [] }, { ...runtime, runId: "eve-run-replay" });
  assert.equal(replayedRoutine.replayed, true);
  assert.equal(replayedRoutine.work.revision, 2);

  const parked = await updateOwnedDocsWork({ signalId, expectedRevision: 2, operationKey: "park-product-decision", action: "park", reasonKind: "product-decision", summary: "Need the maintainer to choose the supported migration cutoff.", artifacts: [] }, { ...runtime, runId: "eve-run-park" });
  assert.equal(parked.work.status, "parked");
  await assert.rejects(updateOwnedDocsWork({ signalId, expectedRevision: 3, operationKey: "wrong-session-resume", action: "resume", summary: "Answer received." }, { sessionId: "different-session", runId: "run-wrong" }), /must resume in Eve session eve-session-owned-1/);
  const resumed = await updateOwnedDocsWork({ signalId, expectedRevision: 3, operationKey: "resume-with-answer", action: "resume", summary: "Maintainer confirmed the migration cutoff; continuing the same work." }, { ...runtime, runId: "eve-run-resume" });
  assert.equal(resumed.work.id, started.work.id);
  assert.equal(resumed.work.status, "active");
  await assert.rejects(updateOwnedDocsWork({ signalId, expectedRevision: 3, operationKey: "stale-correction", action: "correct", summary: "Stale correction.", references: {} }, { ...runtime, runId: "eve-run-stale" }), /changed concurrently/);

  const corrected = await updateOwnedDocsWork({ signalId, expectedRevision: 4, operationKey: "apply-correction", action: "correct", summary: "The maintainer redirected the guide; revising the existing plan and draft.", references: { editorialRecommendationId: "editorial-56-r2", contentPlanId: "plan-56-r2", draftId: "draft-56-r2" } }, { ...runtime, runId: "eve-run-correct" });
  assert.equal(corrected.work.references.contentPlanId, "plan-56-r2");
  const paused = await updateOwnedDocsWork({ signalId, expectedRevision: 5, operationKey: "pause-owned", action: "pause", summary: "Maintainer paused the work." }, { ...runtime, runId: "eve-run-pause" });
  assert.equal(paused.work.status, "paused");
  const resumedPause = await updateOwnedDocsWork({ signalId, expectedRevision: 6, operationKey: "resume-owned", action: "resume", summary: "Maintainer resumed the existing work." }, { ...runtime, runId: "eve-run-resume-2" });
  assert.equal(resumedPause.work.status, "active");

  const draftReady = await updateOwnedDocsWork({ signalId, expectedRevision: 7, operationKey: "draft-ready", action: "record", activityKind: "milestone", milestone: "draft-ready", summary: "The complete draft is ready and repository checks pass.", references: { validationArtifactIds: ["validation-56"] }, artifacts: [{ kind: "authoring-draft", label: "Complete draft", metadata: { changedFiles: ["docs/migration.mdx", "sidebars.ts"] } }, { kind: "validation-result", label: "Repository checks", metadata: { status: "passed" } }] }, { ...runtime, runId: "eve-run-draft" });
  assert.equal(draftReady.work.status, "draft-ready");
  const approval = await updateOwnedDocsWork({ signalId, expectedRevision: 8, operationKey: "request-publication", action: "record", activityKind: "milestone", milestone: "approval-requested", summary: "The checked draft is ready; publication requires explicit approval.", references: { approvalRequestId: "approval-56" }, artifacts: [{ kind: "approval-request", label: "Publish draft PR", metadata: { approval: "required" } }] }, { ...runtime, runId: "eve-run-approval" });
  assert.equal(approval.work.status, "awaiting-approval");
  const afterApproval = await updateOwnedDocsWork({ signalId, expectedRevision: 9, operationKey: "approval-granted", action: "resume", summary: "Publication approval was granted; resuming the same work for writeback." }, { ...runtime, runId: "eve-run-approved" });
  const completed = await updateOwnedDocsWork({ signalId, expectedRevision: 10, operationKey: "complete-owned", action: "complete", outcome: "completed-draft", summary: "Draft publication handoff completed.", references: { publicationArtifactId: "publication-56" }, artifacts: [{ kind: "publication", label: "Draft pull request", url: "https://github.com/example/docs/pull/56", metadata: {} }] }, { ...runtime, runId: "eve-run-complete" });
  assert.equal(afterApproval.work.status, "active");
  assert.equal(completed.work.status, "completed");
  assert.equal(completed.work.outcome, "completed-draft");
  await assert.rejects(updateOwnedDocsWork({ signalId, expectedRevision: 11, operationKey: "after-terminal", action: "pause", summary: "Too late." }, runtime), /terminal/);

  const detail = await getDocsSignal({ id: signalId });
  assert.equal(detail.ownedWork?.id, started.work.id);
  assert.equal(detail.artifacts.filter(({ kind }) => kind === "impact-report").length, 1, "replay does not duplicate artifacts");
  assert.equal(detail.artifacts.some(({ kind }) => kind === "approval-request"), true);
  assert.equal(detail.events.some(({ eventType }) => eventType === "owned-work-correct"), true);
  assert.equal((await getOwnedDocsWork({ signalId })).lastRunId, "eve-run-complete");

  const abandonedSignal = await createSignal("owned-abandoned");
  await startOwnedDocsWork({ signalId: abandonedSignal, operationKey: "accept-abandon", intendedOutcome: "Investigate a replacement guide.", conversation: { kind: "terminal", id: "terminal-56" } }, runtime);
  const abandoned = await updateOwnedDocsWork({ signalId: abandonedSignal, expectedRevision: 1, operationKey: "abandon-work", action: "abandon", summary: "Maintainer abandoned the work and the reversible draft will be reset." }, runtime);
  assert.equal(abandoned.work.outcome, "abandoned");
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  restoreEnvironment("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Owned documentation work checks passed.");

async function createSignal(providerId: string) { const result = await createDocsSignal({ source: { kind: "external-context", provider: "fixture", providerId, authors: [], metadata: {} }, sourceSummary: `Owned work ${providerId}`, extractedClaims: [], likelyDocsConcepts: [], likelyDocsPages: [], productSurfaces: [], missingEvidence: [], priority: 0, links: [], artifacts: [] }); return result.signal.id; }
function restoreEnvironment(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
