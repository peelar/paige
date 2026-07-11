import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "eve/tools";

import { abandonAuthoringDraft, applyAuthoringDraft, inspectAuthoringDraft, prepareAuthoringDraft } from "../agent/lib/authoring-workspace.js";
import { createContentPlan } from "../agent/lib/content-plan.js";
import { createEditorialRecommendation } from "../agent/lib/editorial-recommendation.js";
import type { ResolvedRepositoryInput } from "../agent/lib/repository-contract.js";
import type { WorkflowState } from "../agent/lib/repository-workflow-contract.js";
import { collectChangedFileEntries } from "../agent/lib/github-writeback.js";

const root = await mkdtemp(join(tmpdir(), "docs-agent-authoring-"));
await mkdir(join(root, "docs"), { recursive: true });
await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { build: "node -e \"console.log('docs build passed')\"" } }));
await writeFile(join(root, "sidebars.js"), "module.exports = ['docs/old'];\n");
await writeFile(join(root, "docs/old.mdx"), "# Old page\n");
await writeFile(join(root, "docs/obsolete.mdx"), "# Obsolete page\n");
await writeFile(join(root, "docs/related.mdx"), "# Related\n\nOld guidance.\n");
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
  const asset = Buffer.from([0, 1, 2, 3, 255]).toString("base64");
  const recommendation = await createEditorialRecommendation({
    sourceDecisionReference: "docs-impact:DOCS-53", taskReferences: ["DOCS-53"], reader: "Developers", readerProblem: "They need a complete new guide.", chosenIntervention: "new-document", rationale: "The reader task is not covered by an existing canonical page.", repositoryEvidence: ["No matching page exists."], docsProfileReferences: ["docs profile: guide placement"], sourceEvidence: ["DOCS-53"], workspaceMemoryReferences: [], alternatives: [{ intervention: "focused-patch", reasonRejected: "There is no existing page to patch." }], remainingUncertainty: [], blockingDecisions: [],
  }, state, noPersist);
  const plan = await createContentPlan({
    sourceDecisionReference: "docs-impact:DOCS-53",
    taskReferences: ["DOCS-53"],
    reader: "Developers",
    desiredOutcome: "use the new guide",
    contentType: "guide",
    placement: "docs",
    affectedSurfaces: [{ action: "create", path: "docs/new-page.mdx" }, { action: "change", path: "sidebars.js" }],
    outline: ["Complete guide"], requiredEvidence: [], examples: [], assets: ["static/img/example.bin"], unresolvedDecisions: [],
    validation: ["build", "diff-check"], definitionOfDone: ["The complete multi-file draft passes checks"],
  }, state, noPersist);
  const first = await applyAuthoringDraft({ taskReferences: ["DOCS-53"], operations: [
    { kind: "write-text", path: "docs/new-page.mdx", content: "# New page\n\nA complete page.\n" },
    { kind: "write-text", path: "sidebars.js", content: "module.exports = ['docs/new-page', 'docs/related'];\n" },
    { kind: "write-text", path: "docs/related.mdx", content: "# Related\n\nSee the new page.\n" },
    { kind: "write-binary", path: "static/img/example.bin", contentBase64: asset },
    { kind: "copy", from: "docs/new-page.mdx", to: "docs/copied.mdx" },
    { kind: "move", from: "docs/copied.mdx", to: "docs/moved.mdx" },
    { kind: "move", from: "docs/old.mdx", to: "docs/renamed.mdx" },
    { kind: "delete", path: "docs/obsolete.mdx" },
  ] }, ctx, state, noPersist);
  assert.equal(first?.baseRevision, baseRevision);
  assert.equal(first?.editorialRecommendationId, recommendation.recommendation.id);
  assert.equal(first?.contentPlanId, plan.plan.id);
  assert.equal(first?.changedFiles.length, 8);
  const inspected = await inspectAuthoringDraft({ paths: ["docs/new-page.mdx", "sidebars.js"] }, ctx, state, noPersist);
  assert.equal(inspected.files[0]?.content?.includes("complete page"), true);
  assert.equal(inspected.diff.includes("GIT binary patch"), true);
  assert.equal(inspected.diff.includes("deleted file mode"), true);
  state.materialization.resolvedCommit = "stale-base";
  await assert.rejects(prepareAuthoringDraft({ patchSummary: "Stale draft.", evidence: [], uncertainty: [], checks: ["diff-check"] }, ctx, state, noPersist), /draft base is stale/i);
  state.materialization.resolvedCommit = baseRevision;
  const prepared = await prepareAuthoringDraft({ patchSummary: "Add a complete guide and navigation.", evidence: ["DOCS-53"], uncertainty: [], checks: ["build", "diff-check"] }, ctx, state, noPersist);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.draft.checks.every(({ status }) => status === "passed"), true);
  const publishEntries = await collectChangedFileEntries(ctx, repositoryInput.workingDocumentationRepository, prepared.draft.changedFiles);
  assert.equal(publishEntries.some((entry) => entry.path === "docs/old.mdx" && entry.deleted === true), true);
  assert.equal(publishEntries.some((entry) => entry.path === "docs/obsolete.mdx" && entry.deleted === true), true);
  assert.equal(publishEntries.some((entry) => entry.path === "docs/renamed.mdx" && "content" in entry), true);
  assert.equal(publishEntries.some((entry) => entry.path === "static/img/example.bin" && "contentBase64" in entry), true);
  assert.deepEqual(await readFile(join(root, "static/img/example.bin")), Buffer.from([0, 1, 2, 3, 255]));
  await assert.rejects(applyAuthoringDraft({ taskReferences: [], operations: [{ kind: "write-text", path: "../escape.md", content: "no" }] }, ctx, state, noPersist), /cannot escape/i);
  const readonlyState: WorkflowState = { ...state, repositoryInput: { ...state.repositoryInput, workingDocumentationRepository: { ...state.repositoryInput.workingDocumentationRepository, allowedActions: ["clone", "read", "search", "run-checks", "export-diff"] } } };
  await assert.rejects(applyAuthoringDraft({ taskReferences: [], operations: [{ kind: "write-text", path: "docs/denied.mdx", content: "no" }] }, ctx, readonlyState, noPersist), /action is not allowed: patch/i);
  await abandonAuthoringDraft(ctx, state, noPersist);
  assert.equal(git("status", "--porcelain").trim(), "");
} finally { await rm(root, { recursive: true, force: true }); }

console.log("Authoring workspace behavior checks passed.");
function git(...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }
