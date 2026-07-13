import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "@docs-agent/control-plane/testing";
import { captureLinearDocsSignal } from "../agent/lib/linear-docs-signal";
import { captureSlackDocsSignal } from "../agent/lib/slack-docs-signal";
import {
  createDocsSignal,
  getDocsSignal,
  transitionDocsSignalLifecycle,
} from "../agent/lib/docs-signals";

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-capture-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "signals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();

  await withDocsAgentDatabase((db) => db.run(sql.raw(`
    CREATE TRIGGER fail_initial_lifecycle_event
    BEFORE INSERT ON docs_signal_events
    BEGIN
      SELECT RAISE(ABORT, 'forced initial lifecycle failure');
    END
  `)));
  await assert.rejects(
    () => createDocsSignal({
      source: {
        kind: "manual-scenario",
        provider: "capture-test",
        providerId: "forced-failure",
      },
      sourceSummary: "This capture must roll back when its initial event fails.",
      links: [{ kind: "other", label: "Rollback link" }],
      artifacts: [{ kind: "other", label: "Rollback artifact" }],
      extractedClaims: [],
      likelyDocsConcepts: [],
      likelyDocsPages: [],
      productSurfaces: [],
      missingEvidence: [],
      priority: 0,
    }),
    /Failed query: insert into "docs_signal_events"/,
  );
  assert.deepEqual(await signalTableCounts(), {
    signals: 0,
    sources: 0,
    links: 0,
    artifacts: 0,
    events: 0,
  });
  await withDocsAgentDatabase((db) =>
    db.run(sql.raw("DROP TRIGGER fail_initial_lifecycle_event"))
  );

  const concurrentInput = {
    source: {
      kind: "external-context" as const,
      provider: "capture-test",
      providerId: "concurrent-generic",
    },
    sourceSummary: "The same provider delivery arrived concurrently.",
    extractedClaims: ["One provider delivery should create one signal."],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    priority: 0,
    links: [{ kind: "other" as const, label: "Concurrent delivery" }],
    artifacts: [{ kind: "other" as const, label: "Concurrent capture" }],
  };
  const concurrentResults = await Promise.all(
    Array.from({ length: 20 }, () => createDocsSignal(concurrentInput)),
  );
  assert.equal(concurrentResults.filter(({ created }) => created).length, 1);
  assert.equal(new Set(concurrentResults.map(({ signal }) => signal.id)).size, 1);
  for (const { signal } of concurrentResults) {
    assert.equal(signal.status, "captured");
    assert.equal(signal.sources.length, 1);
    assert.equal(signal.links.length, 1);
    assert.equal(signal.artifacts.length, 1);
    assert.equal(signal.events.length, 1);
  }
  const concurrentSignal = concurrentResults[0]?.signal;
  assert.notEqual(concurrentSignal, undefined);
  assert.equal(concurrentSignal?.sources.length, 1);
  assert.equal(concurrentSignal?.links.length, 1);
  assert.equal(concurrentSignal?.artifacts.length, 1);
  assert.equal(concurrentSignal?.events.length, 1);
  assert.equal(concurrentSignal?.events[0]?.fromStatus, null);
  assert.equal(concurrentSignal?.events[0]?.toStatus, "captured");

  const slackConcurrentInput = {
    channelId: "C_CONCURRENT",
    threadTs: "1783771200.000100",
    messages: [
      {
        author: "U_PRODUCT",
        timestamp: "1783771200.000100",
        text: "A source-backed API change may need documentation.",
      },
    ],
    sourceSummary: "Concurrent Slack delivery for a source-backed API change.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    uncertainty: [],
    priority: 50,
    publicDocsImpact: "substantive" as const,
    sourceEvidence: "available" as const,
    currentDocsState: "not-run" as const,
    evidence: [],
    links: [],
  };
  const concurrentSlackResults = await Promise.all(
    Array.from({ length: 12 }, () => captureSlackDocsSignal(slackConcurrentInput)),
  );
  assert.equal(concurrentSlackResults.filter(({ created }) => created).length, 1);
  assert.equal(new Set(concurrentSlackResults.map(({ signal }) => signal.id)).size, 1);
  for (const { signal } of concurrentSlackResults) {
    assert.equal(signal.status, "captured");
    assert.equal(signal.sources.length, 1);
    assert.equal(signal.events.length, 1);
  }
  let slackAdvanced = concurrentSlackResults[0]?.signal;
  assert.notEqual(slackAdvanced, undefined);
  assert.equal(slackAdvanced?.events.length, 1);
  slackAdvanced = await advanceToPrepared(slackAdvanced!.id);
  const slackAdvancedEventCount = slackAdvanced.events.length;
  const duplicateSlackAdvanced = await captureSlackDocsSignal(slackConcurrentInput);
  assert.equal(duplicateSlackAdvanced.created, false);
  assert.equal(duplicateSlackAdvanced.signal.status, "patch-prepared");
  assert.equal(duplicateSlackAdvanced.signal.events.length, slackAdvancedEventCount);
  assert.equal(duplicateSlackAdvanced.signal.sources.length, 1);

  const slackClosedInput = {
    ...slackConcurrentInput,
    channelId: "C_CLOSED",
    threadTs: "1783774800.000100",
    sourceSummary: "Slack delivery with no public documentation relevance.",
    publicDocsImpact: "none" as const,
    sourceEvidence: "not-needed" as const,
  };
  const slackClosed = await captureSlackDocsSignal(slackClosedInput);
  assert.equal(slackClosed.signal.status, "closed-not-docs-relevant");
  assert.equal(slackClosed.signal.events.length, 1);
  assert.equal(slackClosed.signal.events[0]?.actor, "docs-agent:slack-intake");
  const duplicateSlackClosed = await captureSlackDocsSignal(slackClosedInput);
  assert.equal(duplicateSlackClosed.created, false);
  assert.equal(duplicateSlackClosed.signal.status, "closed-not-docs-relevant");
  assert.equal(duplicateSlackClosed.signal.events.length, 1);

  const linearAdvancedInput = {
    agentSessionId: "session_advanced",
    issueId: "issue_advanced",
    issueIdentifier: "DOC-ADVANCED",
    issueTitle: "Source-backed API docs impact",
    comments: [],
    sourceSummary: "Linear delivery for a source-backed API change.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    uncertainty: [],
    priority: 50,
    publicDocsImpact: "substantive" as const,
    sourceEvidence: "available" as const,
    currentDocsState: "not-run" as const,
    evidence: [],
    links: [],
  };
  const linearAdvancedCapture = await captureLinearDocsSignal(linearAdvancedInput);
  const linearAdvanced = await advanceToPrepared(linearAdvancedCapture.signal.id);
  const duplicateLinearAdvanced = await captureLinearDocsSignal(linearAdvancedInput);
  assert.equal(duplicateLinearAdvanced.created, false);
  assert.equal(duplicateLinearAdvanced.signal.status, "patch-prepared");
  assert.equal(duplicateLinearAdvanced.signal.events.length, linearAdvanced.events.length);
  assert.equal(duplicateLinearAdvanced.signal.sources.length, 1);

  const linearClosedInput = {
    ...linearAdvancedInput,
    agentSessionId: "session_closed",
    issueId: "issue_closed",
    issueIdentifier: "DOC-CLOSED",
    sourceSummary: "Linear delivery with no public documentation relevance.",
    publicDocsImpact: "none" as const,
    sourceEvidence: "not-needed" as const,
  };
  const linearClosed = await captureLinearDocsSignal(linearClosedInput);
  assert.equal(linearClosed.signal.status, "closed-not-docs-relevant");
  assert.equal(linearClosed.signal.events.length, 1);
  assert.equal(linearClosed.signal.events[0]?.actor, "docs-agent:linear-intake");
  const duplicateLinearClosed = await captureLinearDocsSignal(linearClosedInput);
  assert.equal(duplicateLinearClosed.created, false);
  assert.equal(duplicateLinearClosed.signal.status, "closed-not-docs-relevant");
  assert.equal(duplicateLinearClosed.signal.events.length, 1);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Docs signal capture checks passed.");

async function advanceToPrepared(signalId: string) {
  await transitionDocsSignalLifecycle({
    id: signalId,
    status: "docs-verified",
    reason: "Current docs verification completed for the capture test.",
    actor: "docs-agent:current-docs-verification",
  }, "verification");
  return transitionDocsSignalLifecycle({
    id: signalId,
    status: "patch-prepared",
    reason: "A checked patch was prepared for the capture test.",
    actor: "docs-agent:signal-patch-handoff",
  }, "patch-handoff");
}

async function signalTableCounts() {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.all<{
      signals: number;
      sources: number;
      links: number;
      artifacts: number;
      events: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM docs_signals) AS signals,
        (SELECT COUNT(*) FROM docs_signal_sources) AS sources,
        (SELECT COUNT(*) FROM docs_signal_links) AS links,
        (SELECT COUNT(*) FROM docs_signal_artifacts) AS artifacts,
        (SELECT COUNT(*) FROM docs_signal_events) AS events
    `);
    const counts = rows[0];
    assert.notEqual(counts, undefined);
    return {
      signals: Number(counts!.signals),
      sources: Number(counts!.sources),
      links: Number(counts!.links),
      artifacts: Number(counts!.artifacts),
      events: Number(counts!.events),
    };
  });
}
