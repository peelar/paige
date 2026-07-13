import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { createDocsSignal, getDocsSignal } from "../src/docs-signals.ts";
import { DOCS_FOLLOW_UP_MAX_PER_RUN, DOCS_FOLLOW_UP_TIME_ZONE, cancelDocsFollowUp, createDocsFollowUp, getLatestDocsFollowUpRun, listDocsFollowUps, processDueDocsFollowUps } from "../src/docs-follow-ups.ts";
import { test } from "vitest";

test("docs follow ups", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-follow-ups-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "follow-ups.sqlite")}`;
delete process.env.VERCEL;

try {
  await migrateDocsAgentDatabase();
  const signal = await createDocsSignal({ source: { kind: "external-context", provider: "test", providerId: "follow-up-1", authors: [], metadata: {} }, sourceSummary: "Temporary callout needs review.", extractedClaims: [], likelyDocsConcepts: ["temporary callout"], likelyDocsPages: ["docs/callout.mdx"], productSurfaces: [], missingEvidence: [], priority: 0, links: [], artifacts: [] });
  const due = await createDocsFollowUp({ signalId: signal.signal.id, reason: "Confirm whether the temporary callout can be removed after release.", dueAt: "2026-07-11T08:00:00.000Z" });
  const future = await createDocsFollowUp({ signalId: signal.signal.id, reason: "Revisit the deprecation after the next release.", dueAt: "2026-07-20T09:00:00.000Z" });
  const cancelled = await createDocsFollowUp({ signalId: signal.signal.id, reason: "Temporary reminder to cancel.", dueAt: "2026-07-25T09:00:00.000Z" });
  assert.equal((await cancelDocsFollowUp({ id: cancelled.id, reason: "The maintainer removed this follow-up." })).status, "cancelled");
  assert.equal((await listDocsFollowUps({ status: "pending" })).length, 2);
  assert.equal((await getDocsSignal({ id: signal.signal.id })).nextActionAt, due.dueAt);
  assert.equal(DOCS_FOLLOW_UP_TIME_ZONE, "UTC");
  assert.equal(DOCS_FOLLOW_UP_MAX_PER_RUN, 20);

  const first = await processDueDocsFollowUps({ now: new Date("2026-07-11T09:00:00.000Z") });
  assert.equal(first.replayed, false);
  assert.equal(first.run?.status, "completed");
  assert.equal(first.run?.dueCount, 1);
  assert.equal(first.run?.processedCount, 1);
  assert.deepEqual(first.due.map(({ followUpId }) => followUpId), [due.id]);
  assert.equal((await listDocsFollowUps({ status: "completed" }))[0]?.processedOccurrence, "2026-07-11");
  const detail = await getDocsSignal({ id: signal.signal.id });
  assert.equal(detail.nextActionAt, future.dueAt);
  assert.equal(detail.events.some(({ eventType }) => eventType === "scheduled-follow-up-due"), true);

  const replay = await processDueDocsFollowUps({ now: new Date("2026-07-11T18:00:00.000Z") });
  assert.equal(replay.replayed, true);
  assert.equal(replay.due.length, 0);
  assert.equal((await getDocsSignal({ id: signal.signal.id })).events.filter(({ eventType }) => eventType === "scheduled-follow-up-due").length, 1);

  await assert.rejects(processDueDocsFollowUps({ now: new Date("2026-07-12T09:00:00.000Z"), beforeProcess: async () => { throw new Error("fixture persistence failure"); } }), /failed and was recorded/);
  const failed = await getLatestDocsFollowUpRun();
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /fixture persistence failure/);
  assert.equal((await listDocsFollowUps({ status: "pending" })).map(({ id }) => id).includes(future.id), true);
} finally {
  if (originalDatabaseUrl === undefined) delete process.env.DOCS_AGENT_DATABASE_URL; else process.env.DOCS_AGENT_DATABASE_URL = originalDatabaseUrl;
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
  await rm(root, { recursive: true, force: true });
}

console.log("Scheduled docs follow-up checks passed.");
});
