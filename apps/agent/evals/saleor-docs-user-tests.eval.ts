import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { saleorDocsUserTestScenarios } from "./scenarios/saleor-docs-user-test-scenarios";
import { renderScenarioPrompt } from "./scenarios/render";

type Scenario = (typeof saleorDocsUserTestScenarios)[number];

export default [
  ...saleorDocsUserTestScenarios.map((scenario) =>
    defineEval({
      description: scenario.title,
      tags: ["saleor-docs", "user-test", "composable-capabilities", scenario.expected.outcome],
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
        t.loadedSkill("docs-maintenance");
        t.check(
          t.reply,
          satisfies(
            (reply) => matchesScenarioReply(reply, scenario),
            `${scenario.id} final reply summarizes the evidence-backed outcome`,
          ),
        );
        t.calledTool("configure_working_repository", {
          input: (input) => matchesConfigureInput(input, scenario),
          output: (output) => matchesConfiguredRepository(output, scenario),
          count: 1,
        });
        for (const path of scenario.expected.inspectedPaths) {
          t.calledTool("repo_read_file", { input: { path } });
        }
        if (scenario.expected.outcome === "docs-patch") {
          t.calledTool("get_docs_profile");
          t.calledTool("repo_run_checks", {
            output: hasSuccessfulRepositoryCheck,
          });
          t.calledTool("repo_export_diff", {
            output: (output) => matchesPreparedDiff(output, scenario),
          });
        } else {
          t.calledTool("repo_run_checks", {
            output: hasSuccessfulRepositoryCheck,
          });
          t.calledTool("repo_export_diff", {
            output: matchesEmptyDiff,
          });
          t.notCalledTool("authoring_workspace");
          t.notCalledTool("repo_replace_text");
        }

        t.notCalledTool("bash");
        t.notCalledTool("read_file");
        t.notCalledTool("write_file");
        t.notCalledTool("glob");
        t.notCalledTool("grep");
        t.notCalledTool("configure_github_writeback");
        t.notCalledTool("create_docs_signal");
        t.notCalledTool("prepare_docs_signal_patch");
        t.notCalledTool("verify_docs_signal_current_docs");
        t.notCalledTool("publish_working_repository_pr");
      },
    }),
  ),
  defineEval({
    description: "Documentation-impact intent loads maintenance guidance before repository work",
    tags: ["saleor-docs", "skill-routing"],
    timeoutMs: 300_000,
    metadata: {
      expectedTools: ["load_skill"],
    },
    async test(t) {
      await t.send([
        "I need to investigate whether a public API change requires a documentation update.",
        "Start by loading the appropriate on-demand procedure, then tell me how you will proceed.",
        "Do not call repository tools yet.",
      ].join("\n"));

      t.succeeded();
      t.noFailedActions();
      t.loadedSkill("docs-maintenance", { count: 1 });
      t.notCalledTool("configure_working_repository");
    },
  }),
];

function matchesConfiguredRepository(output: unknown, scenario: Scenario): boolean {
  output = unwrapModelOutput(output);
  const repository = scenario.repositoryInput.workingDocumentationRepository;

  return (
    isRecord(output) &&
    output.configured === true &&
    output.repository === repository.source.url &&
    output.ref === repository.ref &&
    (output.docsRoot === undefined || output.docsRoot === repository.docsRoot) &&
    output.sandboxPath === repository.sandboxPath &&
    output.materialized === false
  );
}

function matchesConfigureInput(input: unknown, scenario: Scenario): boolean {
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

function matchesPreparedDiff(output: unknown, scenario: Scenario): boolean {
  output = unwrapModelOutput(output);
  return (
    isRecord(output) &&
    changedOnlyExpectedFiles(output.changedFiles, scenario.expected.expectedTouchedFiles) &&
    includesText(output.diff, scenario.expected.requiredDiffText) &&
    output.noDiff === false
  );
}

function matchesEmptyDiff(output: unknown): boolean {
  output = unwrapModelOutput(output);
  return (
    isRecord(output) &&
    Array.isArray(output.changedFiles) &&
    output.changedFiles.length === 0 &&
    output.diff === "" &&
    output.noDiff === true
  );
}

function matchesScenarioReply(reply: unknown, scenario: Scenario): boolean {
  const text = String(reply).toLowerCase();
  const includesExpectedText = scenario.expected.replyMustInclude.every((token) =>
    text.includes(token.toLowerCase())
  );

  if (!includesExpectedText) return false;
  if (scenario.expected.outcome === "docs-patch") {
    return text.includes("updated") || text.includes("prepared");
  }

  return (
    (text.includes("no change") ||
      text.includes("no docs change") ||
      text.includes("no documentation change") ||
      text.includes("no update")) &&
    (text.includes("no patch") || text.includes("no diff") || text.includes("unchanged"))
  );
}

function hasSuccessfulRepositoryCheck(output: unknown): boolean {
  output = unwrapModelOutput(output);
  return (
    isRecord(output) &&
    Array.isArray(output.checks) &&
    output.checks.some(
      (entry) =>
        isRecord(entry) && entry.status === "passed" && entry.exitCode === 0,
    )
  );
}

function changedOnlyExpectedFiles(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((path) => value.includes(path))
  );
}

function includesText(value: unknown, expected: readonly string[]): boolean {
  const haystack = Array.isArray(value)
    ? value.map((item) => String(item)).join("\n")
    : String(value);
  const normalizedHaystack = haystack.toLowerCase();

  return expected.every((item) => normalizedHaystack.includes(item.toLowerCase()));
}

function includesAll(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && expected.every((item) => value.includes(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapModelOutput(output: unknown): unknown {
  if (isRecord(output) && output.type === "json" && isRecord(output.value)) {
    return output.value;
  }

  return output;
}
