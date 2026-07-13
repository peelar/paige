import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "eve/tools";

import { abandonAuthoringDraft, applyAuthoringDraft, inspectAuthoringDraft } from "../agent/lib/authoring-workspace";
import { createContentPlan, inspectContentPlan, reviseContentPlan } from "../agent/lib/content-plan";
import { createEditorialRecommendation } from "../agent/lib/editorial-recommendation";
import type { ResolvedRepositoryInput } from "../agent/lib/repository-contract";
import type { WorkflowState } from "../agent/lib/repository-workflow-contract";
import { test } from "vitest";

test("content planning", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-content-plan-"));
await mkdir(join(root, "docs"), { recursive: true });
await writeFile(join(root, "docs/existing.mdx"), "# Existing\n\nOriginal sentence.\n");
await writeFile(join(root, "sidebars.js"), "module.exports = ['docs/existing'];\n");
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

try {
  const small = await applyAuthoringDraft({ taskReferences: ["DOCS-SMALL"], operations: [{ kind: "write-text", path: "docs/existing.mdx", content: "# Existing\n\nCorrected sentence.\n" }] }, ctx, state, noPersist);
  assert.equal(small?.contentPlanId, undefined, "localized patches skip content planning");
  assert.equal(inspectContentPlan(state), null);
  await abandonAuthoringDraft(ctx, state, noPersist);

  await assert.rejects(
    applyAuthoringDraft({ taskReferences: ["DOCS-54"], operations: [{ kind: "write-text", path: "docs/new-guide.mdx", content: "# New guide\n" }] }, ctx, state, noPersist),
    /content plan required/i,
  );

  await createEditorialRecommendation({
    sourceDecisionReference: "docs-impact:DOCS-54", taskReferences: ["DOCS-54"], reader: "App developers", readerProblem: "They need a safe upgrade path.", chosenIntervention: "new-document", rationale: "The task is distinct and needs a durable guide.", repositoryEvidence: ["No upgrade guide exists."], docsProfileReferences: ["docs profile: guides"], sourceEvidence: ["DOCS-54"], workspaceMemoryReferences: [], alternatives: [{ intervention: "focused-patch", reasonRejected: "No canonical page covers the task." }], remainingUncertainty: [], blockingDecisions: [],
  }, state, noPersist);
  const created = await createContentPlan({
    sourceDecisionReference: "docs-impact:DOCS-54",
    taskReferences: ["DOCS-54"],
    reader: "App developers",
    desiredOutcome: "complete the upgrade safely",
    contentType: "migration guide",
    placement: "docs/guides",
    affectedSurfaces: [{ action: "create", path: "docs/new-guide.mdx" }, { action: "change", path: "sidebars.js" }],
    outline: ["Prerequisites", "Upgrade steps", "Verification"],
    requiredEvidence: [{ need: "supported upgrade sequence", status: "available", source: "DOCS-54" }],
    examples: ["docs/existing.mdx"],
    assets: [],
    unresolvedDecisions: [],
    validation: ["build", "diff-check"],
    definitionOfDone: ["The guide is reachable from navigation", "The documented checks pass"],
  }, state, noPersist);
  assert.equal(created.continuesToDraft, true);
  assert.match(created.progressUpdate, /Next: draft in the reversible sandbox/);

  const substantial = await applyAuthoringDraft({ taskReferences: ["DOCS-54"], operations: [
    { kind: "write-text", path: "docs/new-guide.mdx", content: "# New guide\n\nUpgrade safely.\n" },
    { kind: "write-text", path: "sidebars.js", content: "module.exports = ['docs/existing', 'docs/new-guide'];\n" },
  ] }, ctx, state, noPersist);
  assert.equal(substantial?.contentPlanId, created.plan.id);
  assert.equal(substantial?.contentPlanRevision, 1);
  assert.equal((await inspectAuthoringDraft({}, ctx, state, noPersist)).changedFiles.length, 2, "ready plans continue directly into drafting");

  const revised = await reviseContentPlan({ ...created.plan, planId: created.plan.id, outline: [...created.plan.outline, "Rollback"] }, state, noPersist);
  assert.equal(revised.plan.revision, 2);
  assert.equal(state.draft?.contentPlanRevision, 2);
  assert.equal(inspectContentPlan(state)?.plan.id, created.plan.id);
  await abandonAuthoringDraft(ctx, state, noPersist);

  await createEditorialRecommendation({
    sourceDecisionReference: "docs-impact:DOCS-BLOCKED", taskReferences: ["DOCS-BLOCKED"], reader: "Administrators", readerProblem: "They need the supported deployment mode.", chosenIntervention: "new-document", rationale: "A distinct administrator task needs a guide once evidence exists.", repositoryEvidence: ["No deployment guide exists."], docsProfileReferences: ["docs profile: admin guides"], sourceEvidence: [], workspaceMemoryReferences: [], alternatives: [], remainingUncertainty: [], blockingDecisions: [],
  }, state, noPersist);
  const blocked = await createContentPlan({
    sourceDecisionReference: "docs-impact:DOCS-BLOCKED",
    taskReferences: ["DOCS-BLOCKED"],
    reader: "Administrators",
    desiredOutcome: "choose the supported deployment mode",
    contentType: "new guide",
    placement: "docs/admin",
    affectedSurfaces: [{ action: "create", path: "docs/deployment.mdx" }],
    outline: ["Choose a mode"],
    requiredEvidence: [{ need: "supported production topology", status: "missing" }],
    examples: [], assets: [],
    unresolvedDecisions: [{ question: "Which deployment mode is the product default?", consequential: true }],
    validation: ["build"],
    definitionOfDone: ["The supported default is evidence-backed"],
  }, state, noPersist);
  assert.equal(blocked.continuesToDraft, false);
  assert.equal(blocked.plan.blockers.length, 2);
  await assert.rejects(
    applyAuthoringDraft({ taskReferences: ["DOCS-BLOCKED"], operations: [{ kind: "write-text", path: "docs/deployment.mdx", content: "# Deployment\n" }] }, ctx, state, noPersist),
    /content plan is blocked/i,
  );
  assert.equal(git("status", "--porcelain").trim(), "", "blocked plans pause before sandbox mutation");
} finally { await rm(root, { recursive: true, force: true }); }

console.log("Content planning behavior checks passed.");
function git(...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }
});
