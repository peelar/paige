import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { defineEval } from "eve/evals";

const evalDataDir = mkdtempSync(join(tmpdir(), "paige-authoring-convergence-eval-"));
const evalSandboxPath = `/workspace/working-docs-${basename(evalDataDir)}`;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(evalDataDir, "docs-agent.sqlite")}`;
const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
const controlPlaneAgentModule = "@docs-agent/control-plane/agent";
const { migrateDocsAgentDatabase } = await import(controlPlaneTestingModule);
const { saveWorkingRepositorySetup } = await import(controlPlaneAgentModule);
await migrateDocsAgentDatabase();
await saveWorkingRepositorySetup({
  workingDocumentationRepository: {
    source: { type: "github-url", url: "https://github.com/peelar/saleor-docs.git" },
    ref: "main",
    docsRoot: "docs",
    sandboxPath: evalSandboxPath,
    accessMode: "sandbox-write",
    allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
    provenanceLabel: "working-documentation-repository",
  },
  watchedRepositories: [],
  contextRepositories: [],
  externalContext: [],
});

const common = [
  "Load the docs-maintenance skill and reuse the configured working documentation repository.",
  "Complete the work in the root session without delegation.",
  "Use canonical working_repository inspection and authoring_workspace mutation only.",
  "Stop after the reversible prepared or failed draft. Do not publish or open a pull request.",
].join("\n");

export default [
  defineEval({
    description: "A focused existing-page patch uses a hash precondition and remains plan-free",
    tags: ["authoring-convergence", "issue-81", "focused-patch"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send([
        common,
        "On the page that documents pagination limits, make one localized clarification that the documented maximum applies to each paginated connection query.",
        "Read the target first, use its returned full-file SHA-256 as expectedContentHash, apply one write-text operation, and prepare with diff-check.",
        "This is a focused patch to an existing canonical page, so do not create a content plan.",
      ].join("\n"));

      t.succeeded();
      t.loadedSkill("docs-maintenance", { count: 1 });
      t.calledTool("working_repository", {
        input: (input) => isRecord(input) && input.mode === "read",
        output: hasFullFileHash,
      });
      t.calledTool("authoring_workspace", {
        input: (input) => authoringApplyHasSafeOperations(input, 1),
        output: (output) => isRecord(output) && output.mode === "apply" && output.ok === true,
      });
      t.calledTool("authoring_workspace", {
        input: (input) => isRecord(input) && input.mode === "prepare",
        output: preparedDraft,
      });
      t.calledTool("docs_work_manage", {
        input: (input) => isRecord(input) && input.operation === "plan",
        count: 0,
      });
      assertNoLegacyOrPublication(t);
    },
  }),
  defineEval({
    description: "A new multi-surface guide is planned before one atomic authoring batch",
    tags: ["authoring-convergence", "issue-81", "multi-file-plan"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send([
        common,
        "Verified product decision DOCS-EVAL-81 says administrators need a new migration guide named authoring-convergence-eval, linked from the repository navigation.",
        "Inspect nearby guides and navigation, create a ready content plan for both surfaces, apply the guide and navigation changes in one authoring batch with create-only and current-hash preconditions, then prepare with diff-check.",
      ].join("\n"));

      t.succeeded();
      t.calledTool("docs_work_manage", { input: (input) => isRecord(input) && input.operation === "decide" });
      t.calledTool("docs_work_manage", { input: (input) => isRecord(input) && input.operation === "plan" && isRecord(input.plan) && input.plan.mode === "create" });
      t.calledTool("authoring_workspace", {
        input: (input) => authoringApplyHasSafeOperations(input, 2),
        output: (output) => isRecord(output) && output.mode === "apply" && output.ok === true,
      });
      t.calledTool("authoring_workspace", {
        input: (input) => isRecord(input) && input.mode === "prepare",
        output: preparedDraft,
      });
      assertNoLegacyOrPublication(t);
    },
  }),
  defineEval({
    description: "A placement correction abandons the prepared draft and replans before revision",
    tags: ["authoring-convergence", "issue-81", "correction-replan"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send([
        common,
        "Verified product decision DOCS-EVAL-81-CORRECTION requires a substantial standalone upgrade guide and navigation entry.",
        "Inspect the repository, recommend and plan the intervention, apply the complete draft, and prepare it with diff-check.",
      ].join("\n"));
      await t.send([
        "Correction: the new guide must not remain standalone. Consolidate the material into the canonical migration guide instead.",
        "Abandon the existing prepared draft by its stable draft id, revise the recommendation and content plan, then apply and prepare the corrected draft. Do not publish.",
      ].join("\n"));

      t.succeeded();
      t.calledTool("authoring_workspace", {
        input: (input) => isRecord(input) && input.mode === "abandon" && typeof input.draftId === "string",
      });
      t.calledTool("docs_work_manage", { input: (input) => isRecord(input) && input.operation === "decide" && isRecord(input.decision) && input.decision.mode === "revise" });
      t.calledTool("docs_work_manage", { input: (input) => isRecord(input) && input.operation === "plan" && isRecord(input.plan) && input.plan.mode === "revise" });
      t.calledTool("authoring_workspace", {
        input: (input) => authoringApplyHasSafeOperations(input, 1),
        output: (output) => isRecord(output) && output.mode === "apply" && output.ok === true,
      });
      t.calledTool("authoring_workspace", {
        input: (input) => isRecord(input) && input.mode === "prepare",
        output: preparedDraft,
      });
      assertNoLegacyOrPublication(t);
    },
  }),
  defineEval({
    description: "A failed diff check remains a visible non-publishable authoring draft",
    tags: ["authoring-convergence", "issue-81", "failed-validation"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send([
        common,
        "This is a failure-path assurance exercise. Find and read the pagination limits page.",
        "Apply one localized text update that intentionally leaves trailing spaces on its added line, using the returned expectedContentHash.",
        "Prepare with diff-check, preserve and report the expected failed check, and do not correct or abandon the failed draft.",
      ].join("\n"));

      t.succeeded();
      t.calledTool("authoring_workspace", {
        input: (input) => authoringApplyHasSafeOperations(input, 1),
        output: (output) => isRecord(output) && output.mode === "apply" && output.ok === true,
      });
      t.calledTool("authoring_workspace", {
        input: (input) => isRecord(input) && input.mode === "prepare",
        output: (output) =>
          isRecord(output) &&
          output.mode === "prepare" &&
          output.ok === false &&
          isRecord(output.draft) &&
          output.draft.status === "checks-failed",
      });
      t.calledTool("docs_work_manage", {
        input: (input) => isRecord(input) && input.operation === "plan",
        count: 0,
      });
      assertNoLegacyOrPublication(t);
    },
  }),
];

function authoringApplyHasSafeOperations(input: unknown, minimum: number): boolean {
  if (!isRecord(input) || input.mode !== "apply" || !Array.isArray(input.operations) || input.operations.length < minimum) return false;
  return input.operations.every((operation) =>
    isRecord(operation) &&
    (operation.createOnly === true || isSha256(operation.expectedContentHash)),
  );
}

function hasFullFileHash(output: unknown): boolean {
  return isRecord(output) && isSha256(output.contentHash) && typeof output.sizeBytes === "number";
}

function preparedDraft(output: unknown): boolean {
  return isRecord(output) && output.mode === "prepare" && output.ok === true && isRecord(output.draft) && output.draft.status === "prepared" && isSha256(output.draft.preparedDiffHash);
}

function isSha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function assertNoLegacyOrPublication(t: { notCalledTool(name: string): unknown }) {
  t.notCalledTool("repo_replace_text");
  t.notCalledTool("prepare_docs_signal_patch");
  t.notCalledTool("publish_working_repository_pr");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
