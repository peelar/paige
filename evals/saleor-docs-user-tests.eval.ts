import { defineEval } from "eve/evals";

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
      t.calledTool("configure_working_repository", {
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
      t.notCalledTool("prepare_working_repository");
      t.notCalledTool("repo_search");
      t.notCalledTool("repo_read_file");
      t.notCalledTool("repo_replace_text");
      t.notCalledTool("repo_run_checks");
      t.notCalledTool("repo_export_diff");
    },
  }),
);

function matchesConfiguredRepository(
  output: unknown,
  scenario: (typeof saleorDocsUserTestScenarios)[number],
): boolean {
  output = unwrapModelOutput(output);

  const materialization = isRecord(output) ? output.materialization : null;

  return (
    isRecord(output) &&
    output.configured === true &&
    ((output.repository === scenario.repositoryInput.workingDocumentationRepository.source.url &&
      output.ref === scenario.repositoryInput.workingDocumentationRepository.ref &&
      output.docsRoot === scenario.repositoryInput.workingDocumentationRepository.docsRoot) ||
      (isRecord(materialization) &&
        materialization.repositoryUrl ===
          scenario.repositoryInput.workingDocumentationRepository.source.url &&
        materialization.requestedRef === scenario.repositoryInput.workingDocumentationRepository.ref &&
        materialization.docsRoot === scenario.repositoryInput.workingDocumentationRepository.docsRoot))
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
      isRecord(output.materialization) &&
      output.materialization.status === "materialized" &&
      output.materialization.repositoryUrl ===
        scenario.repositoryInput.workingDocumentationRepository.source.url &&
      isRecord(output.report) &&
      output.report.decision === "docs-patch" &&
      includesAll(output.changedFiles, ["docs/api-usage/metadata.mdx"]) &&
      excludesPrefix(output.changedFiles, "docs/api-reference/") &&
      typeof output.diff === "string" &&
      output.diff.includes("Private metadata filtering is available only") &&
      checksPassed(output.report.checks, ["diff-check"]) &&
      hasAnyAction(output.actionProvenance, ["clone", "refresh", "reuse"]) &&
      hasActions(output.actionProvenance, [
        "search",
        "read",
        "patch",
        "run-checks",
        "export-diff",
      ])
    );
  }

  if (scenario.id === "saleor-docs-sandbox-rate-limit-false-alarm") {
    return (
      output.ok === true &&
      output.scenarioKind === "sandbox-rate-limit-false-alarm" &&
      isRecord(output.materialization) &&
      output.materialization.status === "materialized" &&
      isRecord(output.report) &&
      output.report.decision === "no-docs-change" &&
      Array.isArray(output.changedFiles) &&
      output.changedFiles.length === 0 &&
      output.noDiff === true &&
      output.diff === "" &&
      checksPassed(output.report.checks, ["diff-quiet"]) &&
      hasAnyAction(output.actionProvenance, ["clone", "refresh", "reuse"]) &&
      hasActions(output.actionProvenance, ["search", "read", "run-checks", "export-diff"])
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
