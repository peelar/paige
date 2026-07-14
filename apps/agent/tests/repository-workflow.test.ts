import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { SandboxCommandResult } from "eve/sandbox";
import type { ToolContext } from "eve/tools";

import {
  detectFixtureScenarioKind,
  runScenarioFixture,
} from "./fixtures/docs-maintenance-scenarios";
import * as operations from "../agent/lib/repository-operations";
import { repositoryInputSchema } from "../agent/lib/repository-contract";
import * as facade from "../agent/lib/repository-workflow";
import * as contract from "../agent/lib/repository-workflow-contract";
import * as state from "../agent/lib/repository-workflow-state";
import * as lifecycle from "../agent/lib/working-repository-lifecycle";
import { test } from "vitest";

test("repository workflow", async () => {
class FakeSandbox {
  readonly commands: string[] = [];
  readonly writes: Array<{ path: string; content: string }> = [];
  private readonly runResults: SandboxCommandResult[];
  private readonly readResults: Array<string | null>;

  constructor(input: {
    runResults: SandboxCommandResult[];
    readResults?: Array<string | null>;
  }) {
    this.runResults = [...input.runResults];
    this.readResults = [...(input.readResults ?? [])];
  }

  async run(input: { command: string }): Promise<SandboxCommandResult> {
    this.commands.push(input.command);
    const result = this.runResults.shift();
    assert.notEqual(result, undefined, `No fake result configured for: ${input.command}`);
    return result;
  }

  async readTextFile(): Promise<string | null> {
    const result = this.readResults.shift();
    assert.notEqual(result, undefined, "No fake file result configured.");
    return result;
  }

  async writeTextFile(input: { path: string; content: string }): Promise<void> {
    this.writes.push(input);
  }
}

assert.equal(facade.docsMaintenanceWorkflowResultSchema, contract.docsMaintenanceWorkflowResultSchema);
assert.equal(facade.repositoryCheckNameSchema, contract.repositoryCheckNameSchema);
assert.equal(facade.repositoryCheckResultSchema, contract.repositoryCheckResultSchema);
assert.equal(facade.repositoryMaterializationSchema, contract.repositoryMaterializationSchema);
assert.equal(facade.loadRepositoryWorkflowState, state.loadRepositoryWorkflowState);
assert.equal(facade.saveConfiguredRepositoryInput, state.saveConfiguredRepositoryInput);
assert.equal(facade.saveRepositoryWorkflowState, state.saveRepositoryWorkflowState);
assert.equal(
  facade.loadOrMaterializeRepositoryWorkflowState,
  lifecycle.loadOrMaterializeRepositoryWorkflowState,
);
assert.equal(facade.materializeWorkingRepository, lifecycle.materializeWorkingRepository);
assert.equal(
  facade.reuseMaterializedWorkingRepository,
  lifecycle.reuseMaterializedWorkingRepository,
);
assert.equal(facade.validateWorkingRepositorySetup, lifecycle.validateWorkingRepositorySetup);
assert.equal(facade.readRepositoryFile, operations.readRepositoryFile);
assert.equal(facade.searchRepository, operations.searchRepository);
assert.equal(facade.runRepositoryCheck, operations.runRepositoryCheck);
assert.equal(facade.exportRepositoryDiff, operations.exportRepositoryDiff);
assert.equal(facade.listChangedFiles, operations.listChangedFiles);

{
  let materializations = 0;
  let releaseMaterialization!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseMaterialization = resolve;
  });
  const materialize = async () => {
    materializations += 1;
    await gate;
  };
  const first = lifecycle.runRepositoryMaterializationFlight("parallel-first-call", materialize);
  const second = lifecycle.runRepositoryMaterializationFlight("parallel-first-call", materialize);
  await Promise.resolve();
  assert.equal(materializations, 1);
  releaseMaterialization();
  await Promise.all([first, second]);
  await lifecycle.runRepositoryMaterializationFlight("parallel-first-call", async () => {
    materializations += 1;
  });
  assert.equal(materializations, 2);
}

{
  const configuredRepository = repositoryInputSchema.parse({
    workingDocumentationRepository: {
      source: { type: "github-url", url: "https://github.com/example/docs.git" },
      ref: "main",
      docsRoot: "docs",
      sandboxPath: "/workspace/working-docs",
    },
    externalContext: [],
  }).workingDocumentationRepository;
  const canonicalToolKey = lifecycle.workingRepositoryOperationKey(
    "shared-session",
    configuredRepository,
  );
  const docsProfileToolKey = lifecycle.workingRepositoryOperationKey(
    "shared-session",
    configuredRepository,
  );
  assert.equal(canonicalToolKey, docsProfileToolKey);
  assert.notEqual(
    canonicalToolKey,
    lifecycle.workingRepositoryOperationKey("other-session", configuredRepository),
  );

  const order: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const first = lifecycle.runWorkingRepositoryOperationSerially(
    canonicalToolKey,
    async () => {
      order.push("first:start");
      markFirstStarted();
      await firstGate;
      order.push("first:end");
    },
  );
  const second = lifecycle.runWorkingRepositoryOperationSerially(
    docsProfileToolKey,
    async () => {
      order.push("second:start");
      order.push("second:end");
    },
  );
  await firstStarted;
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);

  await assert.rejects(
    lifecycle.runWorkingRepositoryOperationSerially(
      "failure-release-test",
      async () => {
        throw new Error("expected operation failure");
      },
    ),
    /expected operation failure/,
  );
  let ranAfterFailure = false;
  await lifecycle.runWorkingRepositoryOperationSerially(
    "failure-release-test",
    async () => {
      ranAfterFailure = true;
    },
  );
  assert.equal(ranAfterFailure, true);
}

const stateSource = await readFile(
  new URL("../agent/lib/repository-workflow-state.ts", import.meta.url),
  "utf8",
);
assert.match(stateSource, /"docs-agent\.repository-workflow-state"/);
assert.match(stateSource, /"docs-agent\.configured-repository-input"/);

const scenarioSource = await readFile(
  new URL("./fixtures/docs-maintenance-scenarios.ts", import.meta.url),
  "utf8",
);
assert.match(scenarioSource, /from "\.\.\/\.\.\/agent\/lib\/repository-operations"/);
assert.equal(scenarioSource.includes("ctx.getSandbox()"), false);

await assert.rejects(
  readFile(new URL("../agent/lib/docs-maintenance-scenarios.ts", import.meta.url), "utf8"),
);

assert.equal(
  detectFixtureScenarioKind(
    "A prototype used 250 objects per connection, but the public limit remains 100.",
    [],
  ),
  "unknown",
);

const lifecycleSource = await readFile(
  new URL("../agent/lib/working-repository-lifecycle.ts", import.meta.url),
  "utf8",
);
assert.match(lifecycleSource, /function detectDocsRoot/);
assert.match(lifecycleSource, /repositoryCacheMarkerSchema/);
assert.equal(lifecycleSource.includes("runPrivateMetadataFilteringScenario"), false);
assert.equal(lifecycleSource.includes("export async function readRepositoryFile"), false);

for (const toolPath of [
  "../agent/tools/working_repository.ts",
  "../agent/tools/get_docs_profile.ts",
  "../agent/tools/authoring_workspace.ts",
]) {
  const toolSource = await readFile(new URL(toolPath, import.meta.url), "utf8");
  assert.match(toolSource, /workingRepositoryOperationKey\(ctx\.session\.id, configuredRepository\)/);
  assert.match(toolSource, /runWorkingRepositoryOperationSerially\(\s*operationKey/);
  assert.equal(toolSource.includes("ctx.getSandbox()"), false);
}
const publishToolSource = await readFile(
  new URL("../agent/tools/publish_working_repository_pr.ts", import.meta.url),
  "utf8",
);
assert.match(publishToolSource, /async execute\(input, ctx\)/);
assert.match(
  publishToolSource,
  /requireCapabilityToolExecution\("publish_working_repository_pr", ctx\)/,
);
assert.match(publishToolSource, /return publishWorkingRepositoryPr\(input, ctx\)/);
const publishCoordinatorSource = await readFile(
  new URL("../agent/lib/github-writeback.ts", import.meta.url),
  "utf8",
);
assert.match(publishCoordinatorSource, /workingRepositoryOperationKey\(ctx\.session\.id, configuredRepository\)/);
assert.match(publishCoordinatorSource, /runWorkingRepositoryOperationSerially\(operationKey/);
const authoringToolSource = await readFile(
  new URL("../agent/tools/authoring_workspace.ts", import.meta.url),
  "utf8",
);
assert.match(authoringToolSource, /toModelOutput: authoringWorkspaceModelOutput/);
assert.match(authoringToolSource, /MAX_MODEL_DIFF_CHARACTERS/);

const operationsSource = await readFile(
  new URL("../agent/lib/repository-operations.ts", import.meta.url),
  "utf8",
);
assert.match(operationsSource, /export async function readRepositoryFile/);
assert.match(operationsSource, /export async function exportRepositoryDiff/);
assert.equal(operationsSource.includes("defineState"), false);

const repositoryInput = repositoryInputSchema.parse({
  workingDocumentationRepository: {
    source: { type: "github-url", url: "https://github.com/example/docs.git" },
    ref: "main",
    docsRoot: "docs",
    sandboxPath: "/workspace/working-docs",
  },
  externalContext: [],
});
const resolvedRepositoryInput = {
  ...repositoryInput,
  workingDocumentationRepository: {
    ...repositoryInput.workingDocumentationRepository,
    docsRoot: "docs",
  },
};

{
  const original =
    "Objects with metadata interface can be filtered by their values. Filtering is only available for public metadata.";
  const sandbox = new FakeSandbox({
    runResults: [commandResult(0, "metadata match\n"), commandResult(0), commandResult(0), commandResult(0)],
    readResults: [original],
  });
  const actionProvenance: facade.RepositoryActionRecord[] = [];
  const report = await runScenarioFixture(
    toolContext(sandbox),
    "private-metadata-filtering",
    resolvedRepositoryInput,
    actionProvenance,
  );

  assert.equal(report.decision, "docs-patch");
  assert.deepEqual(report.affectedPages, ["docs/api-usage/metadata.mdx"]);
  assert.match(sandbox.commands[0], /^rg -n/);
  assert.match(sandbox.commands[1], /^mkdir -p/);
  assert.match(sandbox.commands[2], /^git add --intent-to-add/);
  assert.equal(sandbox.commands[3], "git diff --check");
  assert.equal(sandbox.writes.length, 1);
  assert.equal(sandbox.writes[0].path, "/workspace/working-docs/docs/api-usage/metadata.mdx");
  assert.match(sandbox.writes[0].content, /Private metadata filtering is available/);
  assert.deepEqual(
    actionProvenance.map(({ action, status }) => ({ action, status })),
    [
      { action: "search", status: "success" },
      { action: "read", status: "success" },
      { action: "patch", status: "success" },
      { action: "run-checks", status: "success" },
    ],
  );
}

{
  const sandbox = new FakeSandbox({
    runResults: [commandResult(0, "rate limit match\n"), commandResult(0)],
    readResults: ["Saleor Cloud sandboxes are limited to 120 requests/minute."],
  });
  const actionProvenance: facade.RepositoryActionRecord[] = [];
  const report = await runScenarioFixture(
    toolContext(sandbox),
    "sandbox-rate-limit-false-alarm",
    resolvedRepositoryInput,
    actionProvenance,
  );

  assert.equal(report.decision, "no-docs-change");
  assert.equal(sandbox.writes.length, 0);
  assert.equal(sandbox.commands[1], "git diff --quiet");
  assert.equal(actionProvenance.some(({ action }) => action === "patch"), false);
}

{
  const sandbox = new FakeSandbox({ runResults: [commandResult(0)] });
  const report = await runScenarioFixture(
    toolContext(sandbox),
    "unknown",
    resolvedRepositoryInput,
    [],
  );

  assert.equal(report.decision, "ask-maintainer");
  assert.equal(sandbox.commands[0], "git status --short");
}

console.log("Repository workflow checks passed.");

function toolContext(sandbox: FakeSandbox): ToolContext {
  return {
    abortSignal: new AbortController().signal,
    getSandbox: async () => sandbox,
  } as unknown as ToolContext;
}

function commandResult(
  exitCode: number,
  stdout = "",
  stderr = "",
): SandboxCommandResult {
  return { exitCode, stdout, stderr } as SandboxCommandResult;
}
});
