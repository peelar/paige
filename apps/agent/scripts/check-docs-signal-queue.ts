import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDocsSignal,
  getDocsSignal,
  listDocsSignals,
  updateDocsSignalLifecycle,
} from "../agent/lib/docs-signals.js";
import { withDocsAgentDatabase } from "../agent/lib/db/client.js";
import { docsSignals } from "../agent/lib/db/schema.js";

delete process.env.DOCS_AGENT_DATABASE_URL;
process.env.VERCEL = "1";
await assert.rejects(
  () => listDocsSignals(),
  /DOCS_AGENT_DATABASE_URL is required/,
);

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-queue-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "signals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const created = await createDocsSignal({
  source: {
    kind: "slack-thread",
    provider: "slack",
    providerId: "C123:T456",
    permalink: "https://example.slack.com/archives/C123/p456",
    title: "Private metadata filtering changed",
    authors: ["U123", "U456"],
    sourceText:
      "Staff users can now filter private metadata when they have the right permission.",
    sourceCreatedAt: "2026-07-09T10:00:00.000Z",
    capturedAt: "2026-07-09T10:05:00.000Z",
    metadata: { channelId: "C123", threadTs: "456" },
  },
  sourceSummary: "Slack thread reports permission-bound private metadata filtering.",
  extractedClaims: ["Private metadata filtering is now permission-bound."],
  likelyDocsConcepts: ["metadata filtering"],
  likelyDocsPages: ["docs/api-usage/metadata.mdx"],
  productSurfaces: ["GraphQL API"],
  missingEvidence: ["Need source or release evidence before making public docs claims."],
  links: [
    {
      kind: "docs-page",
      label: "Metadata docs",
      url: "https://docs.saleor.io/api-usage/metadata",
    },
  ],
});

assert.equal(created.created, true);
assert.equal(created.signal.status, "captured");
assert.equal(created.signal.workspaceId, "default");
assert.equal(created.signal.sources[0]?.sourceText?.startsWith("Staff users"), true);
assert.equal(created.signal.sourceSummary.includes("Slack thread"), true);
assert.equal(created.signal.links[0]?.kind, "docs-page");

const duplicate = await createDocsSignal({
  source: {
    kind: "slack-thread",
    provider: "slack",
    providerId: "C123:T456",
    permalink: "https://example.slack.com/archives/C123/p456",
    authors: ["U123"],
  },
  sourceSummary: "Duplicate signal summary should not create a new row.",
});

assert.equal(duplicate.created, false);
assert.equal(duplicate.signal.id, created.signal.id);

const activeSlackSignals = await listDocsSignals({
  sourceKinds: ["slack-thread"],
  statuses: ["captured"],
});
assert.equal(activeSlackSignals.signals.length, 1);
assert.equal(activeSlackSignals.signals[0]?.id, created.signal.id);

const updated = await updateDocsSignalLifecycle({
  id: created.signal.id,
  status: "needs-source-evidence",
  reason: "Slack context is useful, but source evidence is required before docs claims.",
  missingEvidence: ["Source commit or release note confirming the behavior."],
  uncertainty: "Public API behavior is not proven yet.",
  artifacts: [
    {
      kind: "verification-report",
      label: "Skipped verification report",
      path: "reports/signals/private-metadata.md",
    },
  ],
  metadata: { skippedVerification: true },
});

assert.equal(updated.status, "needs-source-evidence");
assert.equal(updated.events[0]?.fromStatus, "captured");
assert.equal(updated.events[0]?.toStatus, "needs-source-evidence");
assert.equal(updated.artifacts[0]?.kind, "verification-report");

const fetched = await getDocsSignal({ id: created.signal.id });
assert.equal(fetched.sources[0]?.sourceText?.includes("Staff users"), true);
assert.equal(fetched.missingEvidence[0]?.includes("Source commit"), true);

await updateDocsSignalLifecycle({
  id: created.signal.id,
  status: "closed-not-docs-relevant",
  reason: "Test close.",
});

const openSignals = await listDocsSignals();
assert.equal(openSignals.signals.some((signal) => signal.id === created.signal.id), false);

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "permalink.sqlite")}`;
const permalinkOnly = await createDocsSignal({
  source: {
    kind: "linear-issue",
    permalink: "https://linear.app/example/issue/DOC-123/private-metadata",
    authors: ["adrian"],
  },
  sourceSummary: "Linear issue asks for docs review.",
});
const permalinkDuplicate = await createDocsSignal({
  source: {
    kind: "linear-issue",
    permalink: "https://linear.app/example/issue/DOC-123/private-metadata",
  },
  sourceSummary: "Duplicate Linear issue.",
});
assert.equal(permalinkDuplicate.created, false);
assert.equal(permalinkDuplicate.signal.id, permalinkOnly.signal.id);

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "stale.sqlite")}`;
await withDocsAgentDatabase(async (db) => {
  await db.insert(docsSignals).values({
    id: "invalid-status",
    workspaceId: "default",
    status: "stale-status",
    sourceKind: "slack-thread",
    sourceSummary: "Invalid status row.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    capturedAt: "2026-07-09T10:00:00.000Z",
    createdAt: "2026-07-09T10:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
  });
});
await assert.rejects(
  () => getDocsSignal({ id: "invalid-status" }),
  /Invalid option/,
);

await rm(tempRoot, { recursive: true, force: true });

console.log("Docs signal queue checks passed.");
