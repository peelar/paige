import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { workspaceKnowledgeEvalSetup } from "./workspace-knowledge-fixture";

const evalDataDir = mkdtempSync(join(tmpdir(), "paige-workspace-knowledge-eval-"));
const sandboxSuffix = basename(evalDataDir);
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(evalDataDir, "docs-agent.sqlite")}`;

const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
const controlPlaneAgentModule = "@docs-agent/control-plane/agent";
const { migrateDocsAgentDatabase } = await import(controlPlaneTestingModule);
const { saveWorkingRepositorySetup } = await import(controlPlaneAgentModule);
await migrateDocsAgentDatabase();
await saveWorkingRepositorySetup(workspaceKnowledgeEvalSetup(sandboxSuffix));

export default defineEval({
  description: "A current-docs answer is checked against one read-only source repository",
  tags: ["workspace-knowledge", "issue-82", "issue-83", "answer-only", "read-only"],
  timeoutMs: 900_000,
  async test(t) {
    await t.send([
      "Answer this current-state question from the configured workspace:",
      "What maximum does the current pagination documentation state for first or last connection queries, and which current Saleor source file implements or tests connection pagination?",
      "Use the configured source registry and one cross-source search to locate the current documentation and source implementation evidence.",
      "Keep current documentation distinct from source implementation evidence and include the inspected source identities, resolved revisions, and paths.",
      "I only need the answer, not a documentation task.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("workspace-knowledge", { count: 1 });
    t.calledTool("workspace_knowledge", {
      input: (input) => isRecord(input) && input.mode === "list",
      output: (output) => hasSources(output, ["working-documentation", "context:saleor-source"]),
    });
    t.calledTool("workspace_knowledge", {
      input: (input) =>
        isRecord(input) &&
        input.mode === "search" &&
        hasStrings(input.sourceIds, ["working-documentation", "context:saleor-source"]),
      output: (output) => hasMatchesFrom(output, ["working-documentation", "context:saleor-source"]),
    });
    t.calledTool("workspace_knowledge", {
      input: (input) => isRecord(input) && input.mode === "read" && input.sourceId === "working-documentation",
      output: (output) => {
        const evidence = inspectedEvidence(output, "working-documentation");
        return evidence !== null &&
          evidence.path === "docs/api-usage/pagination.mdx" &&
          String(evidence.content).includes("100");
      },
    });
    t.calledTool("workspace_knowledge", {
      input: (input) => isRecord(input) && input.mode === "read" && input.sourceId === "context:saleor-source",
      output: (output) => {
        const evidence = inspectedEvidence(output, "context:saleor-source");
        return evidence !== null &&
          evidence.evidenceClass === "source-code-or-merged-change" &&
          String(evidence.path).startsWith("saleor/graphql/");
      },
    });
    t.check(
      t.reply,
      satisfies(
        (reply) => {
          const text = String(reply);
          const revisions = text.match(/\b[a-f0-9]{7,40}\b/giu) ?? [];
          return text.includes("100") &&
            text.includes("working-documentation") &&
            text.includes("context:saleor-source") &&
            text.includes("current-documentation") &&
            text.includes("source-code-or-merged-change") &&
            text.includes("docs/api-usage/pagination.mdx") &&
            text.includes("saleor/graphql/") &&
            new Set(revisions.map((revision) => revision.toLowerCase())).size >= 2;
        },
        "the answer reports the documented limit with both source paths and resolved revisions",
      ),
    );
    assertAnswerOnly(t);
  },
});

function hasSources(output: unknown, sourceIds: string[]): boolean {
  output = unwrapModelOutput(output);
  if (!isRecord(output) || !Array.isArray(output.sources)) return false;
  const sources: unknown[] = output.sources;
  return sourceIds.every((sourceId) =>
    sources.some((source) => isRecord(source) && source.sourceId === sourceId)
  );
}

function hasMatchesFrom(output: unknown, sourceIds: string[]): boolean {
  output = unwrapModelOutput(output);
  if (!isRecord(output) || !Array.isArray(output.matches)) return false;
  const matches: unknown[] = output.matches;
  return sourceIds.every((sourceId) =>
    matches.some((match) => isRecord(match) && match.sourceId === sourceId)
  );
}

function hasStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && expected.every((item) => value.includes(item));
}

function unwrapModelOutput(output: unknown): unknown {
  if (isRecord(output) && output.type === "json" && isRecord(output.value)) {
    return output.value;
  }
  return output;
}

function inspectedEvidence(
  output: unknown,
  sourceId: string,
): Record<string, unknown> | null {
  output = unwrapModelOutput(output);
  return isRecord(output) &&
      output.sourceId === sourceId &&
      typeof output.resolvedRevision === "string"
    ? output
    : null;
}

function assertAnswerOnly(t: { notCalledTool(name: string): unknown }) {
  for (const name of [
    "agent",
    "authoring_workspace",
    "capture_linear_docs_signal",
    "capture_slack_docs_signal",
    "configure_working_repository",
    "configure_github_writeback",
    "docs_work_manage",
    "docs_work_read",
    "docs_follow_up",
    "internal_document",
    "memory_mark_stale",
    "memory_promote",
    "memory_propose",
    "memory_retire",
    "prepare_docs_signal_patch",
    "publish_working_repository_pr",
    "repo_replace_text",
    "scan_watched_repositories",
    "write_file",
  ]) {
    t.notCalledTool(name);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
