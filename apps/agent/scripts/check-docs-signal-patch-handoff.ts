import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-patch-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "patch-handoff.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { createDocsSignal, docsSignalStatusSchema } = await import("../agent/lib/docs-signals.js");
const {
  SignalPatchHandoffError,
  assertSignalCanEnterPatchHandoff,
  prepareDocsSignalPatchInputSchema,
} = await import("../agent/lib/docs-signal-patch-handoff.js");
const {
  buildPullRequestBody,
  publishWorkingRepositoryPrInputSchema,
} = await import("../agent/lib/github-writeback.js");

const verified = await createDocsSignal({
  status: "docs-verified",
  source: {
    kind: "linear-issue",
    provider: "linear",
    providerId: "issue:DOC-123",
    permalink: "https://linear.app/acme/issue/DOC-123/docs-impact",
    title: "DOC-123: Docs impact",
    authors: ["docs@example.com"],
    sourceText: "Release-backed docs signal.",
    capturedAt: "2026-07-09T18:00:00.000Z",
  },
  sourceSummary: "Verified signal says metadata docs are stale.",
  extractedClaims: ["Private metadata filtering is permission-bound."],
  likelyDocsPages: ["docs/api-usage/metadata.mdx"],
  productSurfaces: ["GraphQL API"],
});

assert.doesNotThrow(() =>
  assertSignalCanEnterPatchHandoff(verified.signal, "prepare-patch"),
);
assert.doesNotThrow(() =>
  assertSignalCanEnterPatchHandoff(verified.signal, "no-patch"),
);
assert.equal(docsSignalStatusSchema.parse("patch-failed"), "patch-failed");

const patchInput = prepareDocsSignalPatchInputSchema.parse({
  mode: "prepare-patch",
  signalId: verified.signal.id,
  targetFile: "docs/api-usage/metadata.mdx",
  expectedText: "old text",
  replacementText: "new text",
  patchSummary: "Document permission-bound private metadata filtering.",
});
assert.deepEqual(patchInput.checks, ["diff-check"]);

const noPatchInput = prepareDocsSignalPatchInputSchema.parse({
  mode: "no-patch",
  signalId: verified.signal.id,
  reason: "Current docs already cover the signal.",
});
assert.equal(noPatchInput.mode, "no-patch");

const unverified = await createDocsSignal({
  status: "captured",
  source: {
    kind: "slack-thread",
    provider: "slack",
    providerId: "C123:1783612800.000100",
  },
  sourceSummary: "Captured but not verified signal.",
});
assert.throws(
  () => assertSignalCanEnterPatchHandoff(unverified.signal, "prepare-patch"),
  SignalPatchHandoffError,
);

const missingEvidence = await createDocsSignal({
  status: "needs-source-evidence",
  source: {
    kind: "linear-issue",
    provider: "linear",
    providerId: "issue:DOC-456",
  },
  sourceSummary: "Signal still needs source evidence.",
  missingEvidence: ["Release or source evidence confirming the behavior."],
});
assert.throws(
  () => assertSignalCanEnterPatchHandoff(missingEvidence.signal, "prepare-patch"),
  /source evidence is still insufficient/,
);

assert.equal(
  publishWorkingRepositoryPrInputSchema.parse({ signalId: verified.signal.id }).signalId,
  verified.signal.id,
);

const prBody = buildPullRequestBody({
  result: {
    ok: true,
    scenarioKind: "unknown",
    materialization: {
      repositoryUrl: "https://github.com/acme/docs.git",
      requestedRef: "main",
      resolvedCommit: "abc123",
      docsRoot: "docs",
      sandboxPath: "/workspace/working-docs",
      status: "materialized",
    },
    report: {
      decision: "docs-patch",
      affectedPages: ["docs/api-usage/metadata.mdx"],
      proposedAction: "Review the prepared patch.",
      evidence: [`Signal ${verified.signal.id}: ${verified.signal.sourceSummary}`],
      consideredPages: ["docs/api-usage/metadata.mdx"],
      uncertainty: ["Maintainer should review wording."],
      patchSummary: "Document permission-bound private metadata filtering.",
      checks: [
        {
          name: "diff-check",
          command: "git diff --check",
          exitCode: 0,
          status: "passed",
          stdout: "",
          stderr: "",
        },
      ],
    },
    changedFiles: ["docs/api-usage/metadata.mdx"],
    diff: "diff --git a/docs/api-usage/metadata.mdx b/docs/api-usage/metadata.mdx\n",
    noDiff: false,
    actionProvenance: [],
    rawSandboxToolsPolicy: "Authored repository tools only.",
  },
  baseBranch: "main",
  branchName: "docs-agent/main/abc123-signal",
  diffHash: "hash123",
  changedFiles: ["docs/api-usage/metadata.mdx"],
  signal: verified.signal,
});

assert.match(prBody, /Originating Signal/);
assert.match(prBody, new RegExp(verified.signal.id));
assert.match(prBody, /Verified signal says metadata docs are stale/);
assert.match(prBody, /https:\/\/linear\.app\/acme\/issue\/DOC-123\/docs-impact/);

await rm(tempRoot, { recursive: true, force: true });

console.log("Docs signal patch handoff checks passed.");
