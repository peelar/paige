import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.js";
import {
  getOperatorMemoryDetail,
  listOperatorMemories,
  mutateOperatorMemory,
  OperatorMemoryTransitionError,
} from "../src/workspace-memory-review.js";
import {
  markWorkspaceMemoryStale,
  promoteWorkspaceMemory,
  proposeWorkspaceMemory,
  retireWorkspaceMemory,
} from "../src/workspace-memory.js";

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-memory-review-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "memory-review.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();

  const proposed = await propose("Proposed ownership route", {
    kind: "ownership",
    tags: ["routing", "payments"],
    url: "https://example.com/source?token=browser-secret",
  });
  const activeFresh = await propose("Fresh style convention", {
    kind: "style_rule",
    tags: ["style"],
  });
  await promoteWorkspaceMemory({
    id: activeFresh.record.id,
    reason: "Maintainer confirmed the current convention.",
    actor: "docs-agent:test-seed",
    freshUntil: "2999-01-01T00:00:00.000Z",
  });
  const activeExpired = await propose("Expired release route", {
    kind: "workflow_rule",
    tags: ["release"],
  });
  await promoteWorkspaceMemory({
    id: activeExpired.record.id,
    reason: "Imported old routing context.",
    actor: "docs-agent:test-seed",
    freshUntil: "2000-01-01T00:00:00.000Z",
  });
  const activeUndated = await propose("Undated docs surface", {
    kind: "docs_surface",
    tags: ["surface"],
  });
  await promoteWorkspaceMemory({
    id: activeUndated.record.id,
    reason: "Maintainer confirmed without a freshness deadline.",
    actor: "docs-agent:test-seed",
  });
  const stale = await propose("Stale concept route", {
    kind: "concept",
    tags: ["stale"],
  });
  await promoteWorkspaceMemory({
    id: stale.record.id,
    reason: "Initially confirmed.",
    actor: "docs-agent:test-seed",
  });
  await markWorkspaceMemoryStale({
    id: stale.record.id,
    reason: "The product surface changed.",
    actor: "docs-agent:test-seed",
  });
  const retired = await propose("Retired decision", {
    kind: "decision",
    tags: ["retired"],
  });
  await promoteWorkspaceMemory({
    id: retired.record.id,
    reason: "Initially confirmed.",
    actor: "docs-agent:test-seed",
  });
  await retireWorkspaceMemory({
    id: retired.record.id,
    reason: "Superseded by a newer decision.",
    actor: "docs-agent:test-seed",
  });

  const all = await listOperatorMemories();
  assert.equal(all.records.length, 6);
  assert.equal(find(all.records, proposed.record.id).displayState, "proposed");
  assert.equal(find(all.records, activeFresh.record.id).displayState, "active-fresh");
  assert.equal(find(all.records, activeExpired.record.id).displayState, "active-expired");
  assert.equal(find(all.records, activeUndated.record.id).displayState, "active-undated");
  assert.equal(find(all.records, stale.record.id).displayState, "stale");
  assert.equal(find(all.records, retired.record.id).displayState, "retired");

  const proposedOnly = await listOperatorMemories({ status: "proposed" });
  assert.deepEqual(proposedOnly.records.map(({ id }) => id), [proposed.record.id]);
  const ownershipOnly = await listOperatorMemories({ kind: "ownership" });
  assert.deepEqual(ownershipOnly.records.map(({ id }) => id), [proposed.record.id]);
  const queried = await listOperatorMemories({ query: "payments" });
  assert.deepEqual(queried.records.map(({ id }) => id), [proposed.record.id]);

  const detail = await getOperatorMemoryDetail({ id: proposed.record.id });
  assert.equal(detail.sources[0]?.url, null, "credential-shaped query keys are not rendered");
  assert.match(detail.sources[0]?.sourceText ?? "", /provenance text/i);
  const serializedDetail = JSON.stringify(detail);
  assert.doesNotMatch(serializedDetail, /browser-secret|workspaceId|externalId|metadata/);

  const promoted = await mutateOperatorMemory({
    id: proposed.record.id,
    action: "promote",
    reason: "Operator confirmed the payments ownership route.",
    actor: "docs-agent:github:operator-101",
  });
  assert.equal(promoted.status, "active");
  assert.equal(promoted.events.at(-1)?.actor, "docs-agent:github:operator-101");
  assert.equal(
    promoted.events.at(-1)?.reason,
    "Operator confirmed the payments ownership route.",
  );

  const markedStale = await mutateOperatorMemory({
    id: activeFresh.record.id,
    action: "mark-stale",
    reason: "The style guide needs maintainer review.",
    actor: "docs-agent:github:operator-101",
  });
  assert.equal(markedStale.status, "stale");
  const retiredFromStale = await mutateOperatorMemory({
    id: activeFresh.record.id,
    action: "retire",
    reason: "A replacement style rule is active.",
    actor: "docs-agent:github:operator-101",
  });
  assert.equal(retiredFromStale.status, "retired");

  await assert.rejects(
    () => mutateOperatorMemory({
      id: retired.record.id,
      action: "promote",
      reason: "Invalid transition.",
      actor: "docs-agent:github:operator-101",
    }),
    OperatorMemoryTransitionError,
  );
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  restoreEnvironment("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Workspace memory review checks passed.");

async function propose(
  statement: string,
  input: {
    kind: "concept" | "docs_surface" | "style_rule" | "workflow_rule" | "ownership" | "decision";
    tags: string[];
    url?: string;
  },
) {
  return proposeWorkspaceMemory({
    kind: input.kind,
    statement,
    scope: "Docs Agent operator review",
    summary: `Summary for ${statement}.`,
    tags: input.tags,
    confidence: "medium",
    source: [{
      kind: "maintainer-decision",
      label: "Maintainer review source",
      url: input.url,
      sourceText: "Verbatim provenance text kept separate from model-generated memory text.",
      metadata: { workspaceId: "private-workspace", token: "browser-secret" },
    }],
    proposedBy: "docs-agent:test-seed",
  });
}

function find<T extends { id: string }>(records: T[], id: string): T {
  const record = records.find((candidate) => candidate.id === id);
  assert.notEqual(record, undefined);
  return record!;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
