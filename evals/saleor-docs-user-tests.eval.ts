import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { saleorDocsUserTestScenarios } from "./scenarios/saleor-docs-user-test-scenarios.js";
import { renderScenarioPrompt } from "./scenarios/render.js";

export default saleorDocsUserTestScenarios.map((scenario) =>
  defineEval({
    description: scenario.title,
    tags: ["saleor-docs", "user-test", scenario.expected.outcome],
    timeoutMs: 900_000,
    metadata: {
      scenarioId: scenario.id,
      workingRepository: scenario.repositoryInput.workingDocumentationRepository.source.url,
      expectedOutcome: scenario.expected.outcome,
      promptPreview: renderScenarioPrompt(scenario),
    },
    async test(t) {
      await t.send(renderScenarioPrompt(scenario));

      t.succeeded();
      t.noFailedActions();
      t.toolOrder(["configure_working_repository", "run_docs_maintenance_scenario"]);
      t.check(
        t.reply,
        satisfies(
          (reply) => matchesScenarioReply(reply, scenario),
          `${scenario.id} final reply summarizes the documentation impact decision`,
        ),
      );
      t.calledTool("configure_working_repository", {
        input: (input) => matchesConfigureInput(input, scenario),
        output: (output) => matchesConfiguredRepository(output, scenario),
        count: 1,
      });
      t.calledTool("run_docs_maintenance_scenario", {
        output: (output) => matchesScenarioOutput(output, scenario),
        count: 1,
      });
      t.notCalledTool("bash");
      t.notCalledTool("read_file");
      t.notCalledTool("write_file");
      t.notCalledTool("glob");
      t.notCalledTool("grep");
      t.notCalledTool("configure_github_writeback");
      t.notCalledTool("get_setup_status");
      t.notCalledTool("prepare_configured_working_repository");
      t.notCalledTool("prepare_working_repository");
      t.notCalledTool("repo_search");
      t.notCalledTool("repo_read_file");
      t.notCalledTool("repo_replace_text");
      t.notCalledTool("repo_run_checks");
      t.notCalledTool("repo_export_diff");
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
);

function matchesConfiguredRepository(
  output: unknown,
  scenario: (typeof saleorDocsUserTestScenarios)[number],
): boolean {
  output = unwrapModelOutput(output);

  const materialization = isRecord(output) ? output.materialization : null;
  const repository = scenario.repositoryInput.workingDocumentationRepository;

  return (
    isRecord(output) &&
    output.configured === true &&
    output.repository === repository.source.url &&
    output.ref === repository.ref &&
    (output.docsRoot === undefined || output.docsRoot === repository.docsRoot) &&
    output.sandboxPath === repository.sandboxPath &&
    output.materialized === false &&
    materialization === undefined
  );
}

function matchesConfigureInput(
  input: unknown,
  scenario: (typeof saleorDocsUserTestScenarios)[number],
): boolean {
  const repository = scenario.repositoryInput.workingDocumentationRepository;
  if (!isRecord(input) || !isRecord(input.workingDocumentationRepository)) return false;

  const workingRepository = input.workingDocumentationRepository;
  const source = workingRepository.source;

  return (
    isRecord(source) &&
    source.type === repository.source.type &&
    source.url === repository.source.url &&
    workingRepository.ref === repository.ref &&
    workingRepository.sandboxPath === repository.sandboxPath &&
    workingRepository.accessMode === repository.accessMode &&
    includesAll(workingRepository.allowedActions, [...repository.allowedActions]) &&
    workingRepository.provenanceLabel === repository.provenanceLabel &&
    input.prepareNow === false
  );
}

function matchesScenarioOutput(
  output: unknown,
  scenario: (typeof saleorDocsUserTestScenarios)[number],
): boolean {
  output = unwrapModelOutput(output);

  if (!isRecord(output)) return false;

  if (scenario.id === "saleor-docs-private-metadata-filtering") {
    return (
      output.ok === true &&
      output.scenarioKind === "private-metadata-filtering" &&
      matchesMaterialization(output.materialization, scenario) &&
      isRecord(output.report) &&
      output.report.decision === "docs-patch" &&
      includesAll(output.report.affectedPages, ["docs/api-usage/metadata.mdx"]) &&
      includesAll(output.report.consideredPages, [
        "docs/api-usage/metadata.mdx",
        "docs/api-reference/**",
      ]) &&
      includesText(output.report.evidence, [
        "DOCS-UT-001",
        "DOCS-UT-001-discussion",
        "DOCS-UT-001-release-note",
      ]) &&
      includesAll(output.changedFiles, ["docs/api-usage/metadata.mdx"]) &&
      excludesPrefix(output.changedFiles, "docs/api-reference/") &&
      typeof output.diff === "string" &&
      output.diff.includes("diff --git a/docs/api-usage/metadata.mdx b/docs/api-usage/metadata.mdx") &&
      output.diff.includes("Private metadata filtering is available only") &&
      checksPassed(output.report.checks, ["diff-check"]) &&
      hasAnyAction(output.actionProvenance, ["clone", "refresh", "reuse"]) &&
      hasActions(output.actionProvenance, [
        "search",
        "read",
        "patch",
        "run-checks",
        "export-diff",
      ]) &&
      lacksActions(output.actionProvenance, ["publish-pr"])
    );
  }

  if (scenario.id === "saleor-docs-sandbox-rate-limit-false-alarm") {
    return (
      output.ok === true &&
      output.scenarioKind === "sandbox-rate-limit-false-alarm" &&
      matchesMaterialization(output.materialization, scenario) &&
      isRecord(output.report) &&
      output.report.decision === "no-docs-change" &&
      Array.isArray(output.report.affectedPages) &&
      output.report.affectedPages.length === 0 &&
      includesAll(output.report.consideredPages, ["docs/api-usage/usage-limits.mdx"]) &&
      includesText(output.report.evidence, [
        "DOCS-UT-002",
        "DOCS-UT-002-discussion",
        "docs/api-usage/usage-limits.mdx",
      ]) &&
      Array.isArray(output.changedFiles) &&
      output.changedFiles.length === 0 &&
      output.noDiff === true &&
      output.diff === "" &&
      checksPassed(output.report.checks, ["diff-quiet"]) &&
      hasAnyAction(output.actionProvenance, ["clone", "refresh", "reuse"]) &&
      hasActions(output.actionProvenance, ["search", "read", "run-checks", "export-diff"]) &&
      lacksActions(output.actionProvenance, ["patch", "publish-pr"])
    );
  }

  return false;
}

function matchesMaterialization(
  value: unknown,
  scenario: (typeof saleorDocsUserTestScenarios)[number],
): boolean {
  const repository = scenario.repositoryInput.workingDocumentationRepository;

  return (
    isRecord(value) &&
    value.status === "materialized" &&
    value.repositoryUrl === repository.source.url &&
    value.requestedRef === repository.ref &&
    value.docsRoot === repository.docsRoot &&
    value.sandboxPath === repository.sandboxPath
  );
}

function matchesScenarioReply(
  reply: unknown,
  scenario: (typeof saleorDocsUserTestScenarios)[number],
): boolean {
  const text = String(reply).toLowerCase();

  if (scenario.id === "saleor-docs-private-metadata-filtering") {
    return (
      text.includes("docs/api-usage/metadata.mdx") &&
      text.includes("private metadata") &&
      (text.includes("docs patch") || text.includes("updated") || text.includes("patch"))
    );
  }

  if (scenario.id === "saleor-docs-sandbox-rate-limit-false-alarm") {
    return (
      (text.includes("no docs change") || text.includes("no documentation change")) &&
      text.includes("120") &&
      text.includes("180") &&
      (text.includes("no patch") || text.includes("no diff") || text.includes("unchanged"))
    );
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapModelOutput(output: unknown): unknown {
  if (
    isRecord(output) &&
    output.type === "json" &&
    isRecord(output.value)
  ) {
    return output.value;
  }

  return output;
}

function includesAll(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && expected.every((item) => value.includes(item));
}

function includesText(value: unknown, expected: string[]): boolean {
  if (!Array.isArray(value)) return false;

  const haystack = value
    .map((item) => (typeof item === "string" ? item : ""))
    .join("\n");

  return expected.every((item) => haystack.includes(item));
}

function excludesPrefix(value: unknown, prefix: string): boolean {
  return Array.isArray(value) && value.every((item) => typeof item !== "string" || !item.startsWith(prefix));
}

function checksPassed(value: unknown, expectedNames: string[]): boolean {
  if (!Array.isArray(value)) return false;

  return expectedNames.every((name) =>
    value.some(
      (entry) =>
        isRecord(entry) &&
        entry.name === name &&
        entry.status === "passed" &&
        entry.exitCode === 0,
    ),
  );
}

function hasActions(value: unknown, expectedActions: string[]): boolean {
  if (!Array.isArray(value)) return false;

  return expectedActions.every((action) =>
    value.some((entry) => isRecord(entry) && entry.action === action && entry.status === "success"),
  );
}

function hasAnyAction(value: unknown, expectedActions: string[]): boolean {
  return (
    Array.isArray(value) &&
    expectedActions.some((action) =>
      value.some((entry) => isRecord(entry) && entry.action === action && entry.status === "success"),
    )
  );
}

function lacksActions(value: unknown, deniedActions: string[]): boolean {
  return (
    Array.isArray(value) &&
    deniedActions.every((action) =>
      value.every((entry) => !isRecord(entry) || entry.action !== action),
    )
  );
}
