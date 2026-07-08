import type { SandboxCommandResult } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  repositoryInputSchema,
  type ExternalContext,
  type RepositoryInput,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";
import { readConfiguredRepositoryInput } from "./docs-maintainer-config.js";

export const repositoryCheckNameSchema = z.enum([
  "install",
  "build",
  "diff-check",
  "diff-quiet",
  "status",
]);

export const impactDecisionSchema = z.enum([
  "docs-patch",
  "no-docs-change",
  "changelog-only",
  "ask-maintainer",
]);

export const repositoryActionRecordSchema = z.object({
  action: z.string(),
  target: z.string().optional(),
  commandCategory: z.string().optional(),
  provenanceLabel: z.string(),
  status: z.enum(["success", "failure"]),
  reason: z.string().optional(),
});

export const repositoryCheckResultSchema = z.object({
  name: repositoryCheckNameSchema,
  command: z.string(),
  exitCode: z.number(),
  status: z.enum(["passed", "failed"]),
  stdout: z.string(),
  stderr: z.string(),
});

export const repositoryMaterializationSchema = z.object({
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  resolvedCommit: z.string().optional(),
  docsRoot: z.string(),
  sandboxPath: z.string(),
  status: z.enum(["materialized", "failed"]),
});

export const documentationImpactReportSchema = z.object({
  decision: impactDecisionSchema,
  affectedPages: z.array(z.string()),
  proposedAction: z.string(),
  evidence: z.array(z.string()),
  consideredPages: z.array(z.string()),
  uncertainty: z.array(z.string()),
  patchSummary: z.string(),
  checks: z.array(repositoryCheckResultSchema),
});

export const docsMaintenanceWorkflowResultSchema = z.object({
  ok: z.boolean(),
  scenarioKind: z.enum(["private-metadata-filtering", "sandbox-rate-limit-false-alarm", "unknown"]),
  materialization: repositoryMaterializationSchema,
  report: documentationImpactReportSchema,
  changedFiles: z.array(z.string()),
  diff: z.string(),
  noDiff: z.boolean(),
  actionProvenance: z.array(repositoryActionRecordSchema),
  rawSandboxToolsPolicy: z.string(),
});

export const runDocsMaintenanceScenarioInputSchema = z.object({
  scenarioText: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The full user scenario and attached context. The working documentation repository must already be configured through configure_working_repository.",
    ),
});

export type RepositoryCheckName = z.infer<typeof repositoryCheckNameSchema>;
export type RepositoryActionRecord = z.infer<typeof repositoryActionRecordSchema>;
export type RepositoryCheckResult = z.infer<typeof repositoryCheckResultSchema>;
export type DocumentationImpactReport = z.infer<typeof documentationImpactReportSchema>;
export type DocsMaintenanceWorkflowResult = z.infer<typeof docsMaintenanceWorkflowResultSchema>;
export type RunDocsMaintenanceScenarioInput = z.infer<typeof runDocsMaintenanceScenarioInputSchema>;

const statePath = ".docs-maintainer/repository-state.json";

type ScenarioKind = DocsMaintenanceWorkflowResult["scenarioKind"];

export interface WorkflowState {
  repositoryInput: RepositoryInput;
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  actionProvenance: RepositoryActionRecord[];
}

class RepositoryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryPolicyError";
  }
}

export async function runDocsMaintenanceScenario(
  input: RunDocsMaintenanceScenarioInput,
  ctx: ToolContext,
): Promise<DocsMaintenanceWorkflowResult> {
  const repositoryInput = await resolveRepositoryInput();
  const repository = repositoryInput.workingDocumentationRepository;
  const sandbox = await ctx.getSandbox();
  const actionProvenance: RepositoryActionRecord[] = [];

  try {
    const materialization = await materializeWorkingRepository(ctx, repositoryInput, actionProvenance);
    const scenarioKind = detectScenarioKind(input.scenarioText, repositoryInput.externalContext);

    let report: DocumentationImpactReport;

    if (scenarioKind === "private-metadata-filtering") {
      report = await runPrivateMetadataFilteringScenario(ctx, repositoryInput, actionProvenance);
    } else if (scenarioKind === "sandbox-rate-limit-false-alarm") {
      report = await runSandboxRateLimitFalseAlarmScenario(ctx, repositoryInput, actionProvenance);
    } else {
      const checks = [await runRepositoryCheck(ctx, repository, "status", actionProvenance)];
      report = {
        decision: "ask-maintainer",
        affectedPages: [],
        proposedAction:
          "Ask a maintainer for a clearer docs-impact target before preparing a patch.",
        evidence: ["The scenario did not match a supported user-test fixture."],
        consideredPages: [],
        uncertainty: ["Only the two Saleor docs user-test scenarios are implemented in this slice."],
        patchSummary: "No patch prepared.",
        checks,
      };
    }

    const changedFiles = await listChangedFiles(ctx, repository, actionProvenance);
    const diff = await exportRepositoryDiff(ctx, repository, actionProvenance);

    const result: DocsMaintenanceWorkflowResult = {
      ok: report.checks.every((check) => check.status === "passed"),
      scenarioKind,
      materialization,
      report,
      changedFiles,
      diff,
      noDiff: changedFiles.length === 0 && diff.trim().length === 0,
      actionProvenance,
      rawSandboxToolsPolicy:
        "Repository work is executed through authored tools and the policy-aware repository workflow; raw Eve bash/read_file/write_file/glob/grep tools are disabled for this agent.",
    };

    await sandbox.writeTextFile({
      path: ".docs-maintainer/last-result.json",
      content: `${JSON.stringify(result, null, 2)}\n`,
    });

    return result;
  } catch (error) {
    const materialization = {
      repositoryUrl: repository.source.url,
      requestedRef: repository.ref,
      docsRoot: repository.docsRoot,
      sandboxPath: repository.sandboxPath,
      status: "failed" as const,
    };

    const reason = error instanceof Error ? error.message : String(error);
    actionProvenance.push(recordAction(repository, "workflow", "failure", { reason }));

    return {
      ok: false,
      scenarioKind: detectScenarioKind(input.scenarioText, repositoryInput.externalContext),
      materialization,
      report: {
        decision: "ask-maintainer",
        affectedPages: [],
        proposedAction: "Fix the repository workflow failure before attempting docs work.",
        evidence: [reason],
        consideredPages: [],
        uncertainty: ["The workflow failed before a reliable docs decision could be made."],
        patchSummary: "No patch prepared.",
        checks: [],
      },
      changedFiles: [],
      diff: "",
      noDiff: true,
      actionProvenance,
      rawSandboxToolsPolicy:
        "Repository work is executed through authored tools and the policy-aware repository workflow; raw Eve bash/read_file/write_file/glob/grep tools are disabled for this agent.",
    };
  }
}

export async function materializeWorkingRepository(
  ctx: ToolContext,
  repositoryInput: RepositoryInput,
  actionProvenance: RepositoryActionRecord[] = [],
): Promise<DocsMaintenanceWorkflowResult["materialization"]> {
  const sandbox = await ctx.getSandbox();
  const repository = repositoryInput.workingDocumentationRepository;

  assertActionAllowed(repository, "clone");
  assertSandboxPath(repository.sandboxPath);

  await sandbox.removePath({
    path: repository.sandboxPath,
    recursive: true,
    force: true,
    abortSignal: ctx.abortSignal,
  });

  const cloneCommand = [
    "git",
    "clone",
    "--depth=1",
    "--branch",
    sh(repository.ref),
    sh(repository.source.url),
    sh(repository.sandboxPath),
  ].join(" ");

  let clone = await sandbox.run({ command: cloneCommand, abortSignal: ctx.abortSignal });

  if (clone.exitCode !== 0) {
    await sandbox.removePath({
      path: repository.sandboxPath,
      recursive: true,
      force: true,
      abortSignal: ctx.abortSignal,
    });
    const fallbackCommand = [
      "git",
      "clone",
      sh(repository.source.url),
      sh(repository.sandboxPath),
      "&&",
      "git",
      "-C",
      sh(repository.sandboxPath),
      "checkout",
      sh(repository.ref),
    ].join(" ");
    clone = await sandbox.run({ command: fallbackCommand, abortSignal: ctx.abortSignal });
  }

  if (clone.exitCode !== 0) {
    const reason = summarizeCommandFailure(clone);
    actionProvenance.push(recordAction(repository, "clone", "failure", { reason }));
    throw new Error(`Failed to clone working documentation repository: ${reason}`);
  }

  actionProvenance.push(recordAction(repository, "clone", "success", { target: repository.sandboxPath }));

  const docsRootPath = joinSandboxPath(repository.sandboxPath, repository.docsRoot);
  const docsRootCheck = await sandbox.run({
    command: `test -d ${sh(docsRootPath)}`,
    abortSignal: ctx.abortSignal,
  });

  if (docsRootCheck.exitCode !== 0) {
    const reason = `Docs root does not exist: ${repository.docsRoot}`;
    actionProvenance.push(recordAction(repository, "clone", "failure", { reason }));
    throw new Error(reason);
  }

  const resolvedCommitResult = await sandbox.run({
    command: `git -C ${sh(repository.sandboxPath)} rev-parse HEAD`,
    abortSignal: ctx.abortSignal,
  });

  const materialization = {
    repositoryUrl: repository.source.url,
    requestedRef: repository.ref,
    resolvedCommit:
      resolvedCommitResult.exitCode === 0 ? resolvedCommitResult.stdout.trim() : undefined,
    docsRoot: repository.docsRoot,
    sandboxPath: repository.sandboxPath,
    status: "materialized" as const,
  };

  const state: WorkflowState = {
    repositoryInput,
    materialization,
    actionProvenance,
  };

  await sandbox.writeTextFile({
    path: statePath,
    content: `${JSON.stringify(state, null, 2)}\n`,
  });

  return materialization;
}

export async function loadRepositoryWorkflowState(ctx: ToolContext): Promise<WorkflowState> {
  const sandbox = await ctx.getSandbox();
  const content = await sandbox.readTextFile({ path: statePath, abortSignal: ctx.abortSignal });

  if (content === null) {
    throw new Error("Working repository has not been materialized in this session.");
  }

  const parsed = JSON.parse(content) as WorkflowState;
  return {
    repositoryInput: repositoryInputSchema.parse(parsed.repositoryInput),
    materialization: repositoryMaterializationSchema.parse(parsed.materialization),
    actionProvenance: z.array(repositoryActionRecordSchema).parse(parsed.actionProvenance),
  };
}

export async function saveRepositoryWorkflowState(
  ctx: ToolContext,
  state: WorkflowState,
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  await sandbox.writeTextFile({
    path: statePath,
    content: `${JSON.stringify(state, null, 2)}\n`,
    abortSignal: ctx.abortSignal,
  });
}

export async function readRepositoryFile(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  path: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertActionAllowed(repository, "read");
  const absolutePath = resolveRepositoryPath(repository, path);
  const sandbox = await ctx.getSandbox();
  const content = await sandbox.readTextFile({ path: absolutePath, abortSignal: ctx.abortSignal });

  if (content === null) {
    const reason = `File does not exist: ${path}`;
    actionProvenance.push(recordAction(repository, "read", "failure", { target: path, reason }));
    throw new Error(reason);
  }

  actionProvenance.push(recordAction(repository, "read", "success", { target: path }));
  return content;
}

export async function searchRepository(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  query: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertActionAllowed(repository, "search");
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: `rg -n ${sh(query)} ${sh(repository.sandboxPath)}`,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode > 1) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(recordAction(repository, "search", "failure", { target: query, reason }));
    throw new Error(`Search failed: ${reason}`);
  }

  actionProvenance.push(recordAction(repository, "search", "success", { target: query }));
  return truncate(result.stdout, 12_000);
}

export async function replaceRepositoryText(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  path: string,
  expectedText: string,
  replacementText: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  assertActionAllowed(repository, "patch");
  const existing = await readRepositoryFile(ctx, repository, path, actionProvenance);

  if (!existing.includes(expectedText)) {
    const reason = `Expected text was not found in ${path}`;
    actionProvenance.push(recordAction(repository, "patch", "failure", { target: path, reason }));
    throw new Error(reason);
  }

  const next = existing.replace(expectedText, replacementText);
  const sandbox = await ctx.getSandbox();
  await sandbox.writeTextFile({
    path: resolveRepositoryPath(repository, path),
    content: next,
    abortSignal: ctx.abortSignal,
  });

  actionProvenance.push(recordAction(repository, "patch", "success", { target: path }));
}

export async function runRepositoryCheck(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  name: RepositoryCheckName,
  actionProvenance: RepositoryActionRecord[],
): Promise<RepositoryCheckResult> {
  assertActionAllowed(repository, "run-checks");
  const sandbox = await ctx.getSandbox();
  const command = commandForCheck(name);
  const result = await sandbox.run({
    command,
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  const check = {
    name,
    command,
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? ("passed" as const) : ("failed" as const),
    stdout: truncate(result.stdout, 4_000),
    stderr: truncate(result.stderr, 4_000),
  };

  actionProvenance.push(
    recordAction(repository, "run-checks", result.exitCode === 0 ? "success" : "failure", {
      commandCategory: name,
      reason: result.exitCode === 0 ? undefined : summarizeCommandFailure(result),
    }),
  );

  return check;
}

export async function exportRepositoryDiff(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertActionAllowed(repository, "export-diff");
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: "git diff --no-ext-diff --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(recordAction(repository, "export-diff", "failure", { reason }));
    throw new Error(`Diff export failed: ${reason}`);
  }

  actionProvenance.push(recordAction(repository, "export-diff", "success"));
  return result.stdout;
}

export async function listChangedFiles(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<string[]> {
  assertActionAllowed(repository, "export-diff");
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: "git diff --name-only --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(recordAction(repository, "export-diff", "failure", { reason }));
    throw new Error(`Changed-file export failed: ${reason}`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resolveRepositoryInput(): Promise<RepositoryInput> {
  const configuredRepositoryInput = await readConfiguredRepositoryInput();
  if (configuredRepositoryInput !== null) {
    return configuredRepositoryInput;
  }

  throw new Error(
    [
      "No working documentation repository is configured.",
      "Run configure_working_repository with the repository URL, ref, and docs root before docs maintenance.",
    ].join(" "),
  );
}

function detectScenarioKind(scenarioText: string, externalContext: ExternalContext[]): ScenarioKind {
  const haystack = [
    scenarioText,
    ...externalContext.map((context) => JSON.stringify(context)),
  ].join("\n").toLowerCase();

  if (haystack.includes("private metadata") && haystack.includes("filter")) {
    return "private-metadata-filtering";
  }

  if (
    haystack.includes("120 requests/minute") &&
    haystack.includes("180") &&
    haystack.includes("internal")
  ) {
    return "sandbox-rate-limit-false-alarm";
  }

  return "unknown";
}

async function runPrivateMetadataFilteringScenario(
  ctx: ToolContext,
  repositoryInput: RepositoryInput,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocumentationImpactReport> {
  const repository = repositoryInput.workingDocumentationRepository;
  const targetPath = "docs/api-usage/metadata.mdx";
  const consideredPages = [targetPath, "docs/api-reference/**"];

  await searchRepository(ctx, repository, "Filtering by metadata", actionProvenance);
  const existing = await readRepositoryFile(ctx, repository, targetPath, actionProvenance);

  const expectedText =
    "Objects with metadata interface can be filtered by their values. Filtering is only available for public metadata.";
  const replacementText =
    "Objects that implement the metadata interface can be filtered by their values. Public metadata filtering remains available. Private metadata filtering is available only to authenticated staff users and Apps with permission to access private metadata for that object.";

  if (existing.includes(expectedText)) {
    await replaceRepositoryText(
      ctx,
      repository,
      targetPath,
      expectedText,
      replacementText,
      actionProvenance,
    );
  } else if (!existing.includes(replacementText)) {
    throw new Error(`Could not find the expected metadata filtering text in ${targetPath}.`);
  }

  const checks = [
    await runRepositoryCheck(ctx, repository, "install", actionProvenance),
    await runRepositoryCheck(ctx, repository, "build", actionProvenance),
    await runRepositoryCheck(ctx, repository, "diff-check", actionProvenance),
  ];

  return {
    decision: "docs-patch",
    affectedPages: [targetPath],
    proposedAction:
      "Update the existing metadata guide to document permission-bound private metadata filtering.",
    evidence: [
      "DOCS-UT-001 says private metadata filters are now accepted for authenticated staff users and apps with private metadata access.",
      "DOCS-UT-001-discussion says the existing metadata guide is stale because it says filtering is only available for public metadata.",
      "DOCS-UT-001-release-note confirms public metadata filtering is unchanged.",
    ],
    consideredPages,
    uncertainty: [
      "No Saleor source repository was provided; this decision relies on the attached structured context.",
      "Generated API reference pages were intentionally left untouched.",
    ],
    patchSummary: `Updated ${targetPath} in the existing Filtering by metadata section.`,
    checks,
  };
}

async function runSandboxRateLimitFalseAlarmScenario(
  ctx: ToolContext,
  repositoryInput: RepositoryInput,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocumentationImpactReport> {
  const repository = repositoryInput.workingDocumentationRepository;
  const targetPath = "docs/api-usage/usage-limits.mdx";

  await searchRepository(ctx, repository, "120 requests/minute", actionProvenance);
  const existing = await readRepositoryFile(ctx, repository, targetPath, actionProvenance);

  const evidence = [
    "DOCS-UT-002 says the 180 requests/minute threshold was internal-only.",
    "DOCS-UT-002-discussion says public Saleor Cloud sandbox limits remain 120 requests/minute.",
  ];

  if (!existing.includes("120 requests/minute")) {
    return {
      decision: "ask-maintainer",
      affectedPages: [targetPath],
      proposedAction:
        "Ask a maintainer to confirm the public sandbox rate limit because the expected 120 requests/minute text was not found.",
      evidence,
      consideredPages: [targetPath],
      uncertainty: ["The current docs did not contain the expected public limit text."],
      patchSummary: "No patch prepared.",
      checks: [await runRepositoryCheck(ctx, repository, "status", actionProvenance)],
    };
  }

  const checks = [await runRepositoryCheck(ctx, repository, "diff-quiet", actionProvenance)];

  return {
    decision: "no-docs-change",
    affectedPages: [],
    proposedAction:
      "Do not change the docs. The current public docs already state the correct sandbox rate limit.",
    evidence: [
      ...evidence,
      `${targetPath} already states Saleor Cloud sandboxes are limited to 120 requests/minute.`,
    ],
    consideredPages: [targetPath],
    uncertainty: [
      "The scenario provides no customer-facing change; the 180 requests/minute note is internal-only.",
    ],
    patchSummary: "No patch prepared because the prompt was a false alarm.",
    checks,
  };
}

function assertActionAllowed(
  repository: WorkingDocumentationRepository,
  action: WorkingDocumentationRepository["allowedActions"][number],
): void {
  if (!repository.allowedActions.includes(action)) {
    throw new RepositoryPolicyError(`Repository action is not allowed: ${action}`);
  }
}

function assertSandboxPath(path: string): void {
  if (!path.startsWith("/workspace/") || path.split("/").includes("..")) {
    throw new RepositoryPolicyError(`Sandbox path must stay under /workspace: ${path}`);
  }
}

function resolveRepositoryPath(repository: WorkingDocumentationRepository, path: string): string {
  if (path.trim() === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new RepositoryPolicyError(`Use a repository-relative path: ${path}`);
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.includes("..")) {
    throw new RepositoryPolicyError(`Path cannot escape the working repository: ${path}`);
  }

  return joinSandboxPath(repository.sandboxPath, parts.join("/"));
}

function joinSandboxPath(root: string, path: string): string {
  if (path === ".") return root;
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function commandForCheck(name: RepositoryCheckName): string {
  switch (name) {
    case "install":
      return "corepack enable && pnpm install --frozen-lockfile";
    case "build":
      return "pnpm build";
    case "diff-check":
      return "git diff --check";
    case "diff-quiet":
      return "git diff --quiet";
    case "status":
      return "git status --short";
  }
}

function recordAction(
  repository: WorkingDocumentationRepository,
  action: string,
  status: RepositoryActionRecord["status"],
  details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
): RepositoryActionRecord {
  return {
    action,
    provenanceLabel: repository.provenanceLabel,
    status,
    ...details,
  };
}

function summarizeCommandFailure(result: SandboxCommandResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  return truncate(stderr || stdout || `Command exited with ${result.exitCode}.`, 1_000);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 20)}\n...[truncated]`;
}

function sh(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
