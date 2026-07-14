import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { eq } from "drizzle-orm";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { workspaceKnowledgeEvalSetup } from "./workspace-knowledge-fixture";

const evalDataDir = mkdtempSync(join(tmpdir(), "paige-workspace-knowledge-answers-"));
const sandboxSuffix = basename(evalDataDir);
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(evalDataDir, "docs-agent.sqlite")}`;

const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
const controlPlaneAgentModule = "@docs-agent/control-plane/agent";
const {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
  workspaceSetup,
} = await import(controlPlaneTestingModule);
const { saveWorkingRepositorySetup } = await import(controlPlaneAgentModule);
await migrateDocsAgentDatabase();

export default [
  defineEval({
    description: "A current-documentation question finishes as a sourced answer",
    tags: ["workspace-knowledge", "issue-83", "current-docs", "answer-only"],
    timeoutMs: 900_000,
    async test(t) {
      await ensureWorkspaceKnowledgeSetup();

      const answer = await t.send([
        "In our configured current documentation, what maximum is stated for `first` or `last` connection queries?",
        "Answer with the inspected source identity, evidence class, resolved revision, and path so I can tell how fresh the answer is.",
        "I only need the answer, not a documentation task.",
      ].join("\n"));

      answer.succeeded();
      answer.noFailedActions();
      answer.loadedSkill("workspace-knowledge", { count: 1 });
      answer.calledTool("workspace_knowledge", {
        input: (input) =>
          isRecord(input) &&
          input.mode === "read" &&
          input.sourceId === "working-documentation",
        output: (output) =>
          isEvidence(output, "working-documentation") &&
          output.evidenceClass === "current-documentation" &&
          output.path === "docs/api-usage/pagination.mdx" &&
          String(output.content).includes("100"),
      });
      t.check(
        answer.message,
        satisfies(
          (reply) => {
            const text = String(reply);
            return text.includes("100") &&
              text.includes("working-documentation") &&
              text.includes("current-documentation") &&
              text.includes("docs/api-usage/pagination.mdx") &&
              hasResolvedRevision(text);
          },
          "the answer cites only inspected current-documentation evidence with freshness",
        ),
      );
      assertNoDurableWork(answer);
    },
  }),
  defineEval({
    description: "Conflicting provider and memory context stays separate from public product fact",
    tags: ["workspace-knowledge", "issue-83", "conflict", "trust-boundary"],
    timeoutMs: 900_000,
    async test(t) {
      await ensureWorkspaceKnowledgeSetup();

      const answer = await t.send([
        "A provider conversation says connection queries now allow 250 objects per page.",
        "A workspace-memory routing note repeats the same 250 claim.",
        "Treat those statements as provider-conversation-context and workspace-memory, not as public product proof.",
        "Check the configured current documentation and read-only source repository, then answer what is actually supported today.",
        "Expose the conflict, source freshness, and any remaining insufficiency. Do not create documentation work.",
      ].join("\n"));

      answer.succeeded();
      answer.noFailedActions();
      answer.loadedSkill("workspace-knowledge", { count: 1 });
      assertInspectedPaginationSources(answer);
      t.check(
        answer.message,
        satisfies(
          (reply) => {
            const text = String(reply);
            const lower = text.toLowerCase();
            return text.includes("100") &&
              text.includes("250") &&
              includesAny(lower, ["conflict", "contradict", "disagree", "not supported"]) &&
              lower.includes("provider") &&
              lower.includes("workspace memory") &&
              includesAny(lower, ["not proof", "cannot prove", "does not prove", "unverified"]) &&
              text.includes("working-documentation") &&
              text.includes("context:saleor-source") &&
              hasResolvedRevision(text);
          },
          "the answer exposes the conflict without upgrading conversation or memory into product fact",
        ),
      );
      assertNoDurableWork(answer);
      answer.notCalledTool("memory_propose");
      answer.notCalledTool("memory_promote");
    },
  }),
  defineEval({
    description: "Missing setup permits a proportional unverified general answer",
    tags: ["workspace-knowledge", "issue-83", "missing-setup", "general-answer"],
    timeoutMs: 300_000,
    async test(t) {
      await removeWorkspaceKnowledgeSetup();

      const answer = await t.send([
        "What do our current docs and source say about connection pagination limits?",
        "If the workspace is not configured, do not start setup or pretend you checked it.",
        "Give me the useful general explanation you can support, and say exactly what workspace evidence was not verified.",
      ].join("\n"));

      answer.succeeded();
      answer.noFailedActions();
      answer.loadedSkill("workspace-knowledge", { count: 1 });
      answer.notCalledTool("workspace_knowledge");
      answer.notCalledTool("get_setup_status");
      answer.notCalledTool("configure_working_repository");
      t.check(
        answer.message,
        satisfies(
          (reply) => {
            const lower = String(reply).toLowerCase();
            return includesAny(lower, ["pagination", "page size", "page-size", "limit"]) &&
              includesAny(lower, ["not verified", "could not verify", "couldn't verify", "not configured"]) &&
              lower.includes("documentation") &&
              lower.includes("source") &&
              !includesAny(lower, ["i checked", "i verified", "the configured docs say"]);
          },
          "the answer is useful but explicit that current docs and source were not verified",
        ),
      );
      assertNoDurableWork(answer);
    },
  }),
  defineEval({
    description: "A greeting and ordinary technical explanation stay tool-free",
    tags: ["workspace-knowledge", "issue-83", "conversation", "no-tools"],
    timeoutMs: 180_000,
    async test(t) {
      await removeWorkspaceKnowledgeSetup();

      const greeting = await t.send("Hi Paige!");
      greeting.succeeded();
      greeting.usedNoTools();

      const explanation = await t.send(
        "In general, why do current documentation, source code, and release notes play different roles as evidence?",
      );
      explanation.succeeded();
      explanation.usedNoTools();
      t.check(
        explanation.message,
        satisfies(
          (reply) => {
            const lower = String(reply).toLowerCase();
            return lower.includes("documentation") &&
              lower.includes("source") &&
              lower.includes("release") &&
              !includesAny(lower, ["repository setup", "configure the workspace", "setup mode"]);
          },
          "the ordinary explanation distinguishes evidence roles without setup choreography",
        ),
      );

      t.succeeded();
      t.usedNoTools();
    },
  }),
  defineEval({
    description: "An inspected source-to-docs gap finishes as a recommendation without mutation",
    tags: ["workspace-knowledge", "issue-83", "source-docs-gap", "answer-only"],
    timeoutMs: 900_000,
    async test(t) {
      await ensureWorkspaceKnowledgeSetup();

      const answer = await t.send([
        "Assess a possible documentation gap; I only want the assessment and recommendation.",
        "Inspect the configured source implementation for EditorJSTableBlockModel and the current 3.22-to-3.23 upgrade guide's supported-extension list.",
        "Keep source implementation evidence distinct from current documentation. Main-source presence is not release proof, so state that uncertainty explicitly.",
        "Cite only the inspected source identities, evidence classes, revisions, and paths. Do not create a signal or draft.",
      ].join("\n"));

      answer.succeeded();
      answer.noFailedActions();
      answer.loadedSkill("workspace-knowledge", { count: 1 });
      answer.calledTool("workspace_knowledge", {
        input: (input) =>
          isRecord(input) &&
          input.mode === "read" &&
          input.sourceId === "working-documentation",
        output: (output) =>
          isEvidence(output, "working-documentation") &&
          output.path === "docs/upgrade-guides/core/3-22-to-3-23.mdx",
      });
      answer.calledTool("workspace_knowledge", {
        input: (input) =>
          isRecord(input) &&
          input.mode === "read" &&
          input.sourceId === "context:saleor-source" &&
          input.path === "saleor/core/editorjs/models.py",
        output: (output) =>
          isEvidence(output, "context:saleor-source") &&
          output.evidenceClass === "source-code-or-merged-change" &&
          output.path === "saleor/core/editorjs/models.py" &&
          String(output.content).includes("EditorJSTableBlockModel"),
      });
      t.check(
        answer.message,
        satisfies(
          (reply) => {
            const text = String(reply);
            const lower = text.toLowerCase();
            return text.includes("EditorJSTableBlockModel") &&
              text.includes("@editorjs/table") &&
              text.includes("docs/upgrade-guides/core/3-22-to-3-23.mdx") &&
              text.includes("saleor/core/editorjs/models.py") &&
              text.includes("working-documentation") &&
              text.includes("context:saleor-source") &&
              text.includes("current-documentation") &&
              text.includes("source-code-or-merged-change") &&
              includesAny(lower, ["gap", "missing", "omits", "recommend"]) &&
              lower.includes("release") &&
              includesAny(lower, ["not prove", "does not prove", "cannot prove", "not release proof"]) &&
              hasResolvedRevision(text);
          },
          "the answer recommends docs work from inspected source and current-docs evidence without inventing release proof",
        ),
      );
      assertNoDurableWork(answer);
    },
  }),
  defineEval({
    description: "An explicit follow-up captures docs work with inspected provenance intact",
    tags: ["workspace-knowledge", "issue-83", "multi-turn", "docs-signal", "provenance"],
    metadata: { mutatesDocsSignals: true },
    timeoutMs: 900_000,
    async test(t) {
      await ensureWorkspaceKnowledgeSetup();

      const first = await t.send([
        "Compare our current pagination documentation with the configured read-only source repository.",
        "Tell me the supported maximum and cite the inspected source ids, evidence classes, requested refs, resolved revisions, repository URLs, and paths.",
        "For now this is answer-only research; do not capture or create docs work.",
      ].join("\n"));

      first.succeeded();
      first.noFailedActions();
      first.loadedSkill("workspace-knowledge", { count: 1 });
      const docsCall = first.requireToolCall("workspace_knowledge", {
        input: (input) =>
          isRecord(input) &&
          input.mode === "read" &&
          input.sourceId === "working-documentation",
        output: (output) => isEvidence(output, "working-documentation"),
      });
      const sourceCall = first.requireToolCall("workspace_knowledge", {
        input: (input) =>
          isRecord(input) &&
          input.mode === "read" &&
          input.sourceId === "context:saleor-source",
        output: (output) => isEvidence(output, "context:saleor-source"),
      });
      assertNoDurableWork(first);

      const docsEvidence = unwrapModelOutput(docsCall.output);
      const sourceEvidence = unwrapModelOutput(sourceCall.output);
      const second = await t.send([
        "Please capture this as a documentation signal for a maintainer to review the pagination wording.",
        "Preserve every inspected source id, requested ref, resolved revision, repository URL, path, and evidence class from the answer in the signal's ordinary provenance, links, or evidence metadata.",
        "Capture only; do not verify again, draft, publish, or create workspace memory.",
      ].join("\n"));

      second.succeeded();
      second.noFailedActions();
      second.calledTool("docs_work_manage", {
        input: (input) =>
          isRecord(input) &&
          input.operation === "create" &&
          matchesContinuationSignal(input, [docsEvidence, sourceEvidence]),
        output: (output) => {
          const normalized = unwrapModelOutput(output);
          return isRecord(normalized) &&
            normalized.created === true &&
            isRecord(normalized.signal) &&
            normalized.signal.sourceKind === "external-context";
        },
        count: 1,
      });
      second.calledTool("docs_work_manage", {
        input: (input) => !isRecord(input) || input.operation !== "create",
        count: 0,
      });
      t.check(
        second.message,
        satisfies(
          (reply) => includesAny(String(reply).toLowerCase(), ["captured", "signal", "recorded"]),
          "the follow-up reports the explicitly requested docs-work capture",
        ),
      );
      assertNoMutationBeyondSignal(second);

      t.succeeded();
      t.noFailedActions();
    },
  }),
];

async function ensureWorkspaceKnowledgeSetup(): Promise<void> {
  await saveWorkingRepositorySetup(workspaceKnowledgeEvalSetup(sandboxSuffix));
}

async function removeWorkspaceKnowledgeSetup(): Promise<void> {
  await withDocsAgentDatabase(async (db: EvalDatabase) => {
    await db.delete(workspaceSetup).where(eq(workspaceSetup.id, "default"));
  });
}

type EvalDatabase = {
  delete(table: unknown): {
    where(condition: unknown): PromiseLike<unknown>;
  };
};

function assertInspectedPaginationSources(scope: {
  calledTool(name: string, options?: Record<string, unknown>): unknown;
}): void {
  scope.calledTool("workspace_knowledge", {
    input: (input: unknown) =>
      isRecord(input) &&
      input.mode === "read" &&
      input.sourceId === "working-documentation",
    output: (output: unknown) =>
      isEvidence(output, "working-documentation") &&
      output.path === "docs/api-usage/pagination.mdx",
  });
  scope.calledTool("workspace_knowledge", {
    input: (input: unknown) =>
      isRecord(input) &&
      input.mode === "read" &&
      input.sourceId === "context:saleor-source",
    output: (output: unknown) =>
      isEvidence(output, "context:saleor-source") &&
      output.evidenceClass === "source-code-or-merged-change" &&
      String(output.path).startsWith("saleor/graphql/"),
  });
}

function assertNoDurableWork(scope: {
  notCalledTool(name: string): unknown;
}): void {
  for (const name of [
    "agent",
    "authoring_workspace",
    "capture_linear_docs_signal",
    "capture_slack_docs_signal",
    "configure_github_writeback",
    "configure_working_repository",
    "docs_work_manage",
    "docs_work_read",
    "docs_follow_up",
    "internal_document",
    "memory_mark_stale",
    "memory_promote",
    "memory_propose",
    "memory_retire",
    "publish_working_repository_pr",
    "scan_watched_repositories",
  ]) {
    scope.notCalledTool(name);
  }
}

function assertNoMutationBeyondSignal(scope: {
  notCalledTool(name: string): unknown;
}): void {
  for (const name of [
    "authoring_workspace",
    "capture_linear_docs_signal",
    "capture_slack_docs_signal",
    "configure_github_writeback",
    "configure_working_repository",
    "docs_work_read",
    "docs_follow_up",
    "internal_document",
    "memory_mark_stale",
    "memory_promote",
    "memory_propose",
    "memory_retire",
    "publish_working_repository_pr",
  ]) {
    scope.notCalledTool(name);
  }
}

function matchesContinuationSignal(
  input: unknown,
  evidence: unknown[],
): boolean {
  if (!isRecord(input) || !isRecord(input.source)) return false;
  if (input.source.kind !== "external-context") return false;
  const serialized = JSON.stringify(input);
  return evidence.every((item) => {
    item = unwrapModelOutput(item);
    if (!isRecord(item)) return false;
    return [
      item.sourceId,
      item.evidenceClass,
      item.repositoryUrl,
      item.requestedRef,
      item.resolvedRevision,
      item.path,
    ].every((value) => typeof value === "string" && serialized.includes(value));
  });
}

function isEvidence(
  output: unknown,
  sourceId: string,
): output is Record<string, unknown> {
  output = unwrapModelOutput(output);
  return isRecord(output) &&
    output.sourceId === sourceId &&
    typeof output.repositoryUrl === "string" &&
    typeof output.requestedRef === "string" &&
    typeof output.resolvedRevision === "string" &&
    typeof output.path === "string";
}

function unwrapModelOutput(output: unknown): unknown {
  if (isRecord(output) && output.type === "json" && isRecord(output.value)) {
    return output.value;
  }
  return output;
}

function hasResolvedRevision(value: string): boolean {
  return /\b[a-f0-9]{7,40}\b/iu.test(value);
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
