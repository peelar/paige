import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "eve/tools";
import type { z } from "zod";

import { abandonAuthoringDraft, applyAuthoringDraft } from "../agent/lib/authoring-workspace";
import { createContentPlan } from "../agent/lib/content-plan";
import { createEditorialRecommendation, reviseEditorialRecommendation } from "../agent/lib/editorial-recommendation";
import type { ResolvedRepositoryInput } from "../agent/lib/repository-contract";
import { editorialInterventionSchema, type WorkflowState } from "../agent/lib/repository-workflow-contract";
import { test } from "vitest";

test("editorial recommendation", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-editorial-"));
await mkdir(join(root, "docs"), { recursive: true });
await writeFile(join(root, "docs/canonical.mdx"), "# Canonical\n\nExisting guidance.\n");
await writeFile(join(root, "docs/obsolete.mdx"), "# Obsolete\n\nDuplicated guidance.\n");
git("init", "-q"); git("config", "user.email", "test@example.com"); git("config", "user.name", "Test"); git("add", "."); git("commit", "-qm", "base");
const baseRevision = git("rev-parse", "HEAD").trim();
const sandbox = {
  async run(input: { command: string; workingDirectory?: string }) { const result = spawnSync(input.command, { cwd: input.workingDirectory ?? root, encoding: "utf8", shell: true }); return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; },
  async readTextFile({ path }: { path: string }) { try { return await readFile(path, "utf8"); } catch { return null; } },
  async readBinaryFile({ path }: { path: string }) { try { return await readFile(path); } catch { return null; } },
  async writeTextFile({ path, content }: { path: string; content: string }) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); },
};
const ctx = { getSandbox: async () => sandbox, abortSignal: new AbortController().signal } as unknown as ToolContext;
const repositoryInput: ResolvedRepositoryInput = { workingDocumentationRepository: { source: { type: "github-url", url: "https://github.com/example/docs.git" }, ref: "main", docsRoot: "docs", sandboxPath: root, accessMode: "sandbox-write", allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"], provenanceLabel: "working-documentation-repository" }, watchedRepositories: [], contextRepositories: [], externalContext: [] };
const state: WorkflowState = { repositoryInput, materialization: { repositoryUrl: repositoryInput.workingDocumentationRepository.source.url, requestedRef: "main", resolvedCommit: baseRevision, docsRoot: "docs", sandboxPath: root, status: "materialized" }, actionProvenance: [] };
const noPersist = async () => {};

type Intervention = z.infer<typeof editorialInterventionSchema>;
const planRequired = new Set<Intervention>(["new-document", "rewrite", "restructure", "consolidate", "remove"]);
const blocked = new Set<Intervention>(["wait-for-evidence", "ask-maintainer"]);

try {
  for (const intervention of editorialInterventionSchema.options) {
    const result = await createEditorialRecommendation(inputFor(intervention, `ALL-${intervention}`), state, noPersist);
    const expected = intervention === "no-change" ? "complete-no-change" : blocked.has(intervention) ? "blocked" : planRequired.has(intervention) ? "plan-required" : "proceed";
    assert.equal(result.recommendation.status, expected, `status for ${intervention}`);
  }

  const duplicateRequest = await createEditorialRecommendation({
    ...inputFor("focused-patch", "DOCS-DUPLICATE"),
    maintainerDirection: { requestedIntervention: "new-document", reaffirmed: false },
    rationale: "The requested page would duplicate the canonical guide; update that guide instead.",
    alternatives: [{ intervention: "new-document", reasonRejected: "docs/canonical.mdx already owns this reader task." }],
  }, state, noPersist);
  assert.match(duplicateRequest.summary, /duplicate the canonical guide/);
  const focusedDraft = await applyAuthoringDraft({ taskReferences: ["DOCS-DUPLICATE"], operations: [{ kind: "write-text", path: "docs/canonical.mdx", content: "# Canonical\n\nExisting guidance with the small missing detail.\n" }] }, ctx, state, noPersist);
  assert.equal(focusedDraft?.editorialRecommendationId, duplicateRequest.recommendation.id);
  assert.equal(focusedDraft?.contentPlanId, undefined, "focused patches do not require a content plan");
  await abandonAuthoringDraft(ctx, state, noPersist);

  const consolidation = await createEditorialRecommendation({
    ...inputFor("consolidate", "DOCS-CONSOLIDATE"),
    rationale: "Canonical and obsolete pages conflict; consolidate the reader path and remove obsolete duplication.",
    alternatives: [{ intervention: "focused-patch", reasonRejected: "Another patch would preserve two competing explanations." }],
  }, state, noPersist);
  await assert.rejects(
    applyAuthoringDraft({ taskReferences: ["DOCS-CONSOLIDATE"], operations: [{ kind: "delete", path: "docs/obsolete.mdx" }] }, ctx, state, noPersist),
    /requires a matching ready content plan/i,
  );
  const plan = await createContentPlan({ sourceDecisionReference: "docs-impact:DOCS-CONSOLIDATE", taskReferences: ["DOCS-CONSOLIDATE"], reader: "Developers", desiredOutcome: "find one canonical explanation", contentType: "consolidation", placement: "docs/canonical.mdx", affectedSurfaces: [{ action: "change", path: "docs/canonical.mdx" }, { action: "remove", path: "docs/obsolete.mdx" }], outline: ["Canonical guidance"], requiredEvidence: [], examples: ["docs/canonical.mdx"], assets: [], unresolvedDecisions: [], validation: ["diff-check"], definitionOfDone: ["Only one canonical explanation remains"] }, state, noPersist);
  const consolidatedDraft = await applyAuthoringDraft({ taskReferences: ["DOCS-CONSOLIDATE"], operations: [{ kind: "write-text", path: "docs/canonical.mdx", content: "# Canonical\n\nConsolidated guidance.\n" }, { kind: "delete", path: "docs/obsolete.mdx" }] }, ctx, state, noPersist);
  assert.equal(consolidatedDraft?.editorialRecommendationId, consolidation.recommendation.id);
  assert.equal(consolidatedDraft?.contentPlanId, plan.plan.id);
  await abandonAuthoringDraft(ctx, state, noPersist);

  await assert.rejects(
    createEditorialRecommendation({ ...inputFor("focused-patch", "DOCS-REAFFIRMED"), maintainerDirection: { requestedIntervention: "new-document", reaffirmed: true } }, state, noPersist),
    /follow the reaffirmed maintainer intervention/i,
  );
  const reaffirmed = await createEditorialRecommendation({ ...inputFor("new-document", "DOCS-REAFFIRMED"), maintainerDirection: { requestedIntervention: "new-document", reaffirmed: true } }, state, noPersist);
  assert.equal(reaffirmed.recommendation.chosenIntervention, "new-document");
  const revised = await reviseEditorialRecommendation({ ...inputFor("new-document", "DOCS-REAFFIRMED"), recommendationId: reaffirmed.recommendation.id, rationale: "The maintainer reaffirmed the distinct reader need after reviewing the duplication tradeoff." }, state, noPersist);
  assert.equal(revised.recommendation.revision, 2);

  const waiting = await createEditorialRecommendation(inputFor("wait-for-evidence", "DOCS-MISSING"), state, noPersist);
  assert.equal(waiting.recommendation.status, "blocked");
  await assert.rejects(
    applyAuthoringDraft({ taskReferences: ["DOCS-MISSING"], operations: [{ kind: "write-text", path: "docs/canonical.mdx", content: "# Unsupported claim\n" }] }, ctx, state, noPersist),
    /pauses drafting/i,
  );
  assert.equal(git("status", "--porcelain").trim(), "", "missing evidence pauses before mutation");
} finally { await rm(root, { recursive: true, force: true }); }

console.log("Editorial recommendation behavior checks passed.");

function inputFor(intervention: Intervention, task: string) {
  const isBlocked = blocked.has(intervention);
  return {
    sourceDecisionReference: `docs-impact:${task}`, taskReferences: [task], reader: "Developers", readerProblem: "They need accurate task guidance.", chosenIntervention: intervention,
    rationale: `Repository evidence supports ${intervention}.`, repositoryEvidence: ["docs/canonical.mdx was inspected"], docsProfileReferences: ["docs profile: canonical guides"], sourceEvidence: isBlocked ? [] : [task], workspaceMemoryReferences: [], alternatives: [], remainingUncertainty: isBlocked ? ["Required evidence is unavailable."] : [], blockingDecisions: isBlocked ? ["Confirm the public product behavior before writing."] : [],
  } as const;
}
function git(...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }
});
