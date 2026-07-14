import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "@docs-agent/control-plane/testing";
import {
  docsWorkManageInputSchema,
  manageDocsWork,
  projectDocsWorkModelOutput,
  readDocsWork,
} from "../agent/lib/docs-work";
import { test } from "vitest";

test("docs work capabilities", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-work-capability-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "docs-work.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;

  const ctx = {
    session: { id: "session-docs-work", turn: { id: "run-docs-work" } },
  } as never;

  try {
    await migrateDocsAgentDatabase();

    for (const privileged of [
      { actor: "caller" },
      { status: "docs-verified" },
      { workspaceId: "another-workspace" },
    ]) {
      assert.equal(docsWorkManageInputSchema.safeParse({
        operation: "create",
        source: {
          kind: "external-context",
          operationKey: "manual-gap-84",
          authors: [],
          metadata: {},
        },
        sourceSummary: "A verified workspace gap needs maintainer review.",
        extractedClaims: [],
        likelyDocsConcepts: [],
        likelyDocsPages: [],
        productSurfaces: [],
        missingEvidence: [],
        priority: 0,
        links: [],
        artifacts: [],
        ...privileged,
      }).success, false);
    }
    assert.equal(docsWorkManageInputSchema.safeParse({
      operation: "create",
      source: {
        kind: "external-context",
        operationKey: "manual-gap-84",
        provider: "slack",
        authors: [],
        metadata: {},
      },
      sourceSummary: "A caller must not select provider admission identity.",
      extractedClaims: [],
      likelyDocsConcepts: [],
      likelyDocsPages: [],
      productSurfaces: [],
      missingEvidence: [],
      priority: 0,
      links: [],
      artifacts: [],
    }).success, false);

    const created = await manageDocsWork({
      operation: "create",
      source: {
        kind: "external-context",
        operationKey: "manual-gap-84",
        authors: [],
        metadata: {},
      },
      sourceSummary: "A verified workspace gap needs maintainer review.",
      extractedClaims: ["The canonical guide omits the supported option."],
      likelyDocsConcepts: ["supported option"],
      likelyDocsPages: ["docs/guide.mdx"],
      productSurfaces: ["public API"],
      missingEvidence: [],
      priority: 50,
      links: [],
      artifacts: [],
    }, ctx);
    assert.equal(created.created, true);
    assert.equal(created.ownership, null, "localized work is not forced into substantial ownership");

    const replayedCreate = await manageDocsWork({
      operation: "create",
      source: {
        kind: "external-context",
        operationKey: "manual-gap-84",
        authors: [],
        metadata: {},
      },
      sourceSummary: "A duplicate request must reuse the original work.",
      extractedClaims: [],
      likelyDocsConcepts: [],
      likelyDocsPages: [],
      productSurfaces: [],
      missingEvidence: [],
      priority: 0,
      links: [],
      artifacts: [],
    }, ctx);
    assert.equal(replayedCreate.created, false);
    assert.equal(replayedCreate.signal.id, created.signal.id);

    const linked = await manageDocsWork({
      operation: "link_evidence",
      workId: created.signal.id,
      expectedUpdatedAt: created.signal.updatedAt,
      operationKey: "link-evidence-84",
      reason: "Linked the inspected current-docs page.",
      links: [{ kind: "docs-page", label: "Canonical guide", url: "https://example.com/docs/guide" }],
      artifacts: [{ kind: "impact-report", label: "Evidence summary", metadata: { sourceId: "working-documentation" } }],
      metadata: { resolvedRevision: "abc123" },
    }, ctx);
    assert.equal(linked.replayed, false);
    assert.equal(linked.signal.status, "captured", "evidence cannot manufacture a verified transition");
    assert.equal(linked.signal.events[0]?.actor, "docs-agent:docs-work");

    const replayedLink = await manageDocsWork({
      operation: "link_evidence",
      workId: created.signal.id,
      expectedUpdatedAt: created.signal.updatedAt,
      operationKey: "link-evidence-84",
      reason: "A retry must not duplicate evidence.",
      links: [],
      artifacts: [],
      metadata: {},
    }, ctx);
    assert.equal(replayedLink.replayed, true);
    assert.equal(replayedLink.signal.links.length, 1);
    assert.equal(replayedLink.signal.artifacts.length, 1);

    const projected = JSON.stringify(projectDocsWorkModelOutput({
      operation: "inspect",
      work: {
        ...replayedLink.signal,
        sources: [{
          ...replayedLink.signal.sources[0],
          sourceText: "raw provider text xoxb-secret-value",
          metadata: { token: "lin_api_secret", operationKey: "internal-operation" },
        }],
        events: [{
          ...replayedLink.signal.events[0],
          metadata: {
            token: "lin_api_secret",
            operationKey: "internal-operation",
            note: "Bearer secret-value",
          },
        }],
      },
    }));
    assert.doesNotMatch(projected, /raw provider text|xoxb-secret-value|lin_api_secret|internal-operation|Bearer secret-value|manual-gap-84/);
    assert.match(projected, /hasSourceText/);
    assert.match(projected, /\[redacted\]/);

    const found = await readDocsWork({ operation: "find", statuses: [], sourceKinds: [], openOnly: true, limit: 20 });
    assert.equal(found.operation, "find");
    assert.equal(found.signals.some(({ id }) => id === created.signal.id), true);
    const inspected = await readDocsWork({ operation: "inspect", workId: created.signal.id });
    assert.equal(inspected.operation, "inspect");
    assert.equal(inspected.work.id, created.signal.id);

    assert.equal(docsWorkManageInputSchema.safeParse({
      operation: "triage",
      workId: created.signal.id,
      outcome: "docs-verified",
      reason: "Caller-selected privileged status.",
    }).success, false);
    await assert.rejects(
      manageDocsWork({
        operation: "link_evidence",
        workId: "another-resource",
        expectedUpdatedAt: created.signal.updatedAt,
        operationKey: "cross-resource-link",
        reason: "Must not cross resource scope.",
        links: [],
        artifacts: [],
        metadata: {},
      }, ctx),
      /Docs signal not found/,
    );

    const concurrent = await Promise.allSettled([
      manageDocsWork({
        operation: "link_evidence",
        workId: created.signal.id,
        expectedUpdatedAt: replayedLink.signal.updatedAt,
        operationKey: "concurrent-evidence-a",
        reason: "Concurrent evidence A.",
        links: [{ kind: "other", label: "A" }],
        artifacts: [],
        metadata: {},
      }, ctx),
      manageDocsWork({
        operation: "link_evidence",
        workId: created.signal.id,
        expectedUpdatedAt: replayedLink.signal.updatedAt,
        operationKey: "concurrent-evidence-b",
        reason: "Concurrent evidence B.",
        links: [{ kind: "other", label: "B" }],
        artifacts: [],
        metadata: {},
      }, ctx),
    ]);
    assert.equal(concurrent.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(({ status }) => status === "rejected").length, 1);

    const pauseWork = await manageDocsWork({
      operation: "create",
      source: {
        kind: "manual-scenario",
        operationKey: "manual-pause-work-84",
        authors: [],
        metadata: {},
      },
      sourceSummary: "Substantial documentation work that a maintainer may pause.",
      extractedClaims: [],
      likelyDocsConcepts: [],
      likelyDocsPages: [],
      productSurfaces: [],
      missingEvidence: [],
      priority: 40,
      links: [],
      artifacts: [],
      ownership: {
        operationKey: "start-pause-work-84",
        intendedOutcome: "Prepare a checked substantial documentation draft.",
        conversation: { kind: "terminal", id: "session-docs-work" },
      },
    }, ctx);
    assert.equal(pauseWork.ownership?.work.status, "active");
    const paused = await manageDocsWork({
      operation: "park",
      workId: pauseWork.signal.id,
      expectedRevision: 1,
      operationKey: "pause-work-84",
      summary: "The maintainer paused this work.",
      reasonKind: "manual-pause",
      artifacts: [],
    }, ctx);
    assert.equal(paused.work.status, "paused");
    const resumed = await manageDocsWork({
      operation: "resume",
      workId: pauseWork.signal.id,
      expectedRevision: 2,
      operationKey: "resume-pause-work-84",
      summary: "The maintainer resumed the original work.",
    }, ctx);
    assert.equal(resumed.work.status, "active");
    const abandoned = await manageDocsWork({
      operation: "finish",
      workId: pauseWork.signal.id,
      expectedRevision: 3,
      operationKey: "abandon-work-84",
      summary: "The maintainer abandoned the original work.",
      outcome: "abandoned",
      references: {},
      artifacts: [],
    }, ctx);
    assert.equal(abandoned.work.status, "abandoned");
    assert.equal(abandoned.work.outcome, "abandoned");

    const failedWork = await manageDocsWork({
      operation: "create",
      source: {
        kind: "manual-scenario",
        operationKey: "failed-work-84",
        authors: [],
        metadata: {},
      },
      sourceSummary: "Substantial documentation work that may fail terminally.",
      extractedClaims: [],
      likelyDocsConcepts: [],
      likelyDocsPages: [],
      productSurfaces: [],
      missingEvidence: [],
      priority: 40,
      links: [],
      artifacts: [],
      ownership: {
        operationKey: "start-failed-work-84",
        intendedOutcome: "Prepare a checked substantial documentation draft.",
        conversation: { kind: "terminal", id: "session-docs-work" },
      },
    }, ctx);
    const failed = await manageDocsWork({
      operation: "finish",
      workId: failedWork.signal.id,
      expectedRevision: 1,
      operationKey: "finish-failed-work-84",
      summary: "An unrecoverable failure ended the original work.",
      outcome: "failed",
      references: {},
      artifacts: [{ kind: "validation-result", label: "Terminal failure", metadata: {} }],
    }, ctx);
    assert.equal(failed.work.status, "failed");
    assert.equal(failed.work.outcome, "failed");
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
