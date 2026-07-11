import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Watched repository release scan stays read-only",
  tags: ["watched-repositories", "release-scan", "read-only"],
  timeoutMs: 900_000,
  metadata: {
    workingRepository: "https://github.com/peelar/saleor-docs.git",
    watchedRepository: "https://github.com/saleor/saleor.git",
  },
  async test(t) {
    await t.send(renderPrompt());

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("watched-repository-scan", { count: 1 });
    t.toolOrder([
      "load_skill",
      "configure_working_repository",
      "scan_watched_repositories",
    ]);
    t.check(
      t.reply,
      satisfies(
        (reply) => String(reply).toLowerCase().includes("watched") &&
          String(reply).toLowerCase().includes("read-only"),
        "final reply summarizes the watched repository scan as read-only evidence",
      ),
    );
    t.calledTool("configure_working_repository", {
      input: (input) => matchesConfigureInput(input),
      count: 1,
    });
    t.calledTool("scan_watched_repositories", {
      input: (input) =>
        isRecord(input) &&
        (input.maxReleasesPerRepository === undefined || input.maxReleasesPerRepository === 1),
      output: (output) => matchesScanOutput(output),
      count: 1,
    });
    t.notCalledTool("bash");
    t.notCalledTool("read_file");
    t.notCalledTool("write_file");
    t.notCalledTool("glob");
    t.notCalledTool("grep");
    t.notCalledTool("run_docs_maintenance_scenario");
    t.notCalledTool("repo_replace_text");
    t.notCalledTool("repo_run_checks");
    t.notCalledTool("repo_export_diff");
    t.notCalledTool("publish_working_repository_pr");
  },
});

function renderPrompt(): string {
  return [
    "Run the watched repository scan for recent release signals and possible docs gaps.",
    "First call configure_working_repository with prepareNow false and the full config below.",
    "Then call scan_watched_repositories with maxReleasesPerRepository 1.",
    "Use watched repositories only as read-only source evidence. Do not patch, push, or open a PR.",
    "",
    "## Working Documentation Repository",
    "URL: https://github.com/peelar/saleor-docs.git",
    "Ref: main",
    "Docs root: docs",
    "Sandbox path: /workspace/working-docs",
    "Allowed actions: clone, read, search, patch, run-checks, export-diff, publish-pr",
    "",
    "## Watched Repositories",
    "- id: saleor-core",
    "  name: Saleor Core",
    "  description: Primary product and API repository documented by this docs site.",
    "  importance: critical",
    "  URL: https://github.com/saleor/saleor.git",
    "  defaultRef: main",
    "  sandboxPath: /workspace/watched/saleor-core",
    "  accessMode: sandbox-read",
    "  allowedActions: clone, read, search, inspect-diff, run-readonly-checks",
    "  pathFilters: saleor/graphql/**, saleor/**, CHANGELOG.md",
    "  signals: releases",
    "  provenanceLabel: watched-repository:saleor/saleor",
  ].join("\n");
}

function matchesConfigureInput(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.workingDocumentationRepository)) return false;
  if (!Array.isArray(input.watchedRepositories) || input.watchedRepositories.length !== 1) {
    return false;
  }

  const workingRepository = input.workingDocumentationRepository;
  const watchedRepository = input.watchedRepositories[0];
  const watchedSource = isRecord(watchedRepository) ? watchedRepository.source : null;

  return (
    isRecord(workingRepository.source) &&
    workingRepository.source.url === "https://github.com/peelar/saleor-docs.git" &&
    workingRepository.accessMode === "sandbox-write" &&
    isRecord(watchedRepository) &&
    isRecord(watchedSource) &&
    watchedRepository.id === "saleor-core" &&
    watchedSource.url === "https://github.com/saleor/saleor.git" &&
    watchedRepository.accessMode === "sandbox-read" &&
    Array.isArray(watchedRepository.allowedActions) &&
    !watchedRepository.allowedActions.includes("patch") &&
    !watchedRepository.allowedActions.includes("publish-pr") &&
    input.prepareNow === false
  );
}

function matchesScanOutput(output: unknown): boolean {
  output = unwrapModelOutput(output);
  if (!isRecord(output)) return false;

  return (
    output.noWatchedRepositories === false &&
    Array.isArray(output.scannedRepositories) &&
    output.scannedRepositories.some(
      (repository) => isRecord(repository) && repository.id === "saleor-core",
    ) &&
    Array.isArray(output.actionProvenance) &&
    lacksActions(output.actionProvenance, ["patch", "publish-pr"])
  );
}

function lacksActions(value: unknown, actions: string[]): boolean {
  return Array.isArray(value) &&
    value.every((entry) => !isRecord(entry) || !actions.includes(String(entry.action)));
}

function unwrapModelOutput(output: unknown): unknown {
  if (isRecord(output) && output.type === "json" && isRecord(output.value)) {
    return output.value;
  }

  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
