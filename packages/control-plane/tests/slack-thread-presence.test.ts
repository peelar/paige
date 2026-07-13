import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  docsSignalSources,
  slackThreadPresences,
} from "../src/db/schema.ts";
import {
  captureDocsSignal,
  transitionDocsSignalLifecycle,
} from "../src/docs-signals.ts";
import { DEFAULT_WORKSPACE_ID } from "../src/setup-state.ts";
import {
  continueSlackThreadPresence,
  endSlackThreadPresence,
  enrollSlackThreadPresence,
  resolveSlackThreadPresenceForSignal,
} from "../src/slack-thread-presence.ts";
import { test } from "vitest";

test("slack thread presence", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-slack-presence-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "presence.sqlite")}`;

try {
  await migrateDocsAgentDatabase();
  const base = {
    teamId: "T123",
    channelId: "C123",
    threadTs: "100.000",
    chatThreadId: "slack:C123:100.000",
    continuationToken: "slack:C123:100.000",
    inviterUserId: "U_INVITER",
    nowMs: 1_000,
    ttlMs: 100,
  };
  const enrolled = await enrollSlackThreadPresence(base);
  assert.equal(enrolled.status, "active");
  assert.equal(enrolled.continuationToken, base.continuationToken);
  assert.equal((await continueSlackThreadPresence({ chatThreadId: base.chatThreadId, nowMs: 1_050, ttlMs: 100 })).admitted, true);
  const expired = await continueSlackThreadPresence({ chatThreadId: base.chatThreadId, nowMs: 1_151, ttlMs: 100 });
  assert.equal(expired.admitted, false);
  assert.equal(expired.presence?.status, "expired");

  await enrollSlackThreadPresence({ ...base, nowMs: 2_000 });
  const dismissed = await endSlackThreadPresence({ chatThreadId: base.chatThreadId, status: "dismissed", reason: "explicit-dismissal", nowMs: 2_010 });
  assert.equal(dismissed?.status, "dismissed");
  assert.equal((await continueSlackThreadPresence({ chatThreadId: base.chatThreadId, nowMs: 2_020 })).admitted, false);

  await enrollSlackThreadPresence({ ...base, nowMs: 3_000 });
  const resolved = await resolveSlackThreadPresenceForSignal({ channelId: base.channelId, threadTs: base.threadTs, signalId: "signal-1", nowMs: 3_010 });
  assert.equal(resolved?.status, "resolved");
  assert.match(resolved?.endReason ?? "", /signal-1/);

  const lifecycleThreads = [
    { channelId: "C_MULTI_A", threadTs: "500.001" },
    { channelId: "C_MULTI_B", threadTs: "500.002" },
    { channelId: "C_MALFORMED", threadTs: "500.003" },
    { channelId: "C_NON_SLACK", threadTs: "500.004" },
    { channelId: "C_ENDED", threadTs: "500.005" },
  ];
  for (const [index, thread] of lifecycleThreads.entries()) {
    await enrollSlackThreadPresence({
      ...base,
      ...thread,
      chatThreadId: `slack:${thread.channelId}:${thread.threadTs}`,
      continuationToken: `slack:${thread.channelId}:${thread.threadTs}`,
      nowMs: 5_000 + index,
    });
  }
  await endSlackThreadPresence({
    chatThreadId: "slack:C_ENDED:500.005",
    status: "dismissed",
    reason: "already-ended",
    nowMs: 5_100,
  });

  const lifecycleSignal = await captureDocsSignal({
    source: {
      kind: "slack-thread",
      provider: "slack",
      providerId: "C_MULTI_A:500.001",
      authors: [],
      metadata: { channelId: "C_MULTI_A", threadTs: "500.001" },
    },
    sourceSummary: "A signal with several provider sources.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    priority: 0,
    links: [],
    artifacts: [],
  }, {
    status: "captured",
    reason: "Captured for lifecycle presence testing.",
    actor: "docs-agent:test",
  });
  await withDocsAgentDatabase(async (db) => {
    const capturedAt = lifecycleSignal.signal.capturedAt;
    const createdAt = lifecycleSignal.signal.createdAt;
    await db.insert(docsSignalSources).values([
      sourceRow({
        signalId: lifecycleSignal.signal.id,
        provider: "slack",
        providerId: "C_MULTI_B:500.002",
        sourceKind: "slack-thread",
        metadata: { channelId: "C_MULTI_B", threadTs: "500.002" },
        capturedAt,
        createdAt,
      }),
      sourceRow({
        signalId: lifecycleSignal.signal.id,
        provider: "slack",
        providerId: "C_MALFORMED:500.003",
        sourceKind: "slack-thread",
        metadata: { channelId: "C_MALFORMED" },
        capturedAt,
        createdAt,
      }),
      sourceRow({
        signalId: lifecycleSignal.signal.id,
        provider: "linear",
        providerId: "issue:NON-SLACK",
        sourceKind: "linear-issue",
        metadata: { channelId: "C_NON_SLACK", threadTs: "500.004" },
        capturedAt,
        createdAt,
      }),
      sourceRow({
        signalId: lifecycleSignal.signal.id,
        provider: "slack",
        providerId: "C_ENDED:500.005",
        sourceKind: "slack-thread",
        metadata: { channelId: "C_ENDED", threadTs: "500.005" },
        capturedAt,
        createdAt,
      }),
    ]);
  });

  const closedSignal = await transitionDocsSignalLifecycle({
    id: lifecycleSignal.signal.id,
    status: "closed-not-docs-relevant",
    reason: "Close the multi-source signal.",
    actor: "docs-agent:test",
    links: [],
    artifacts: [],
    metadata: {},
  }, "intake");
  const presenceByChannel = await readPresenceByChannel();
  const lifecycleEndedAt = Date.parse(closedSignal.updatedAt);
  for (const channelId of ["C_MULTI_A", "C_MULTI_B"]) {
    assert.equal(presenceByChannel.get(channelId)?.status, "resolved");
    assert.equal(presenceByChannel.get(channelId)?.endedAt, lifecycleEndedAt);
    assert.equal(
      presenceByChannel.get(channelId)?.endReason,
      `docs-signal-resolved:${closedSignal.id}`,
    );
  }
  assert.equal(presenceByChannel.get("C_MALFORMED")?.status, "active");
  assert.equal(presenceByChannel.get("C_NON_SLACK")?.status, "active");
  assert.equal(presenceByChannel.get("C_ENDED")?.status, "dismissed");
  assert.equal(presenceByChannel.get("C_ENDED")?.endReason, "already-ended");

  const initialThread = { channelId: "C_INITIAL", threadTs: "500.006" };
  await enrollSlackThreadPresence({
    ...base,
    ...initialThread,
    chatThreadId: "slack:C_INITIAL:500.006",
    continuationToken: "slack:C_INITIAL:500.006",
    nowMs: 6_000,
  });
  const initiallyClosed = await captureDocsSignal({
    source: {
      kind: "slack-thread",
      provider: "slack",
      providerId: "C_INITIAL:500.006",
      authors: [],
      metadata: initialThread,
    },
    sourceSummary: "A Slack signal closed during initial intake.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    priority: 0,
    links: [],
    artifacts: [],
  }, {
    status: "closed-not-docs-relevant",
    reason: "Initial intake closed the signal.",
    actor: "docs-agent:test",
  });
  const initialPresence = (await readPresenceByChannel()).get("C_INITIAL");
  assert.equal(initialPresence?.status, "resolved");
  assert.equal(initialPresence?.endedAt, Date.parse(initiallyClosed.signal.updatedAt));

  await enrollSlackThreadPresence({
    ...base,
    ...initialThread,
    chatThreadId: "slack:C_INITIAL:500.006",
    continuationToken: "slack:C_INITIAL:500.006",
    nowMs: 7_000,
  });
  const duplicateClosed = await captureDocsSignal({
    source: {
      kind: "slack-thread",
      provider: "slack",
      providerId: "C_INITIAL:500.006",
      authors: [],
      metadata: initialThread,
    },
    sourceSummary: "A repeated delivery for the initially closed Slack signal.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    priority: 0,
    links: [],
    artifacts: [],
  }, {
    status: "closed-not-docs-relevant",
    reason: "Repeated intake found the existing closed signal.",
    actor: "docs-agent:test",
  });
  assert.equal(duplicateClosed.created, false);
  assert.equal(
    (await readPresenceByChannel()).get("C_INITIAL")?.status,
    "resolved",
  );

  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => enrollSlackThreadPresence({ ...base, inviterUserId: `U${index}`, nowMs: 4_000 + index })));
  assert.equal(new Set(concurrent.map(({ id }) => id)).size, 1, "concurrent enrollment keeps one presence record");
} finally {
  if (originalUrl === undefined) delete process.env.DOCS_AGENT_DATABASE_URL;
  else process.env.DOCS_AGENT_DATABASE_URL = originalUrl;
  await rm(root, { recursive: true, force: true });
}

console.log("Slack thread presence checks passed.");

function sourceRow(input: {
  signalId: string;
  provider: string;
  providerId: string;
  sourceKind: string;
  metadata: Record<string, unknown>;
  capturedAt: string;
  createdAt: string;
}) {
  return {
    id: randomUUID(),
    signalId: input.signalId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    sourceKind: input.sourceKind,
    provider: input.provider,
    providerId: input.providerId,
    authors: [],
    capturedAt: input.capturedAt,
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}

async function readPresenceByChannel() {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.select().from(slackThreadPresences);
    return new Map(rows.map((presence) => [presence.channelId, presence]));
  });
}
});
