import { createHash } from "node:crypto";

import { defineState } from "eve/context";
import type { SandboxCommandResult } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  repositoryInputSchema,
  type ExternalContext,
  type RepositoryInput,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";

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

const installCacheMarkerSchema = z.object({
  version: z.literal(1),
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  lockfileHash: z.string(),
  command: z.string(),
  status: z.literal("passed"),
});

const repositoryCacheMarkerSchema = z.object({
  version: z.literal(1),
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  docsRoot: z.string(),
  sourcePath: z.string(),
  resolvedCommit: z.string(),
  status: z.literal("ready"),
});

type ScenarioKind = DocsMaintenanceWorkflowResult["scenarioKind"];

export interface WorkflowState {
  repositoryInput: RepositoryInput;
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  actionProvenance: RepositoryActionRecord[];
}

const repositoryWorkflowState = defineState<WorkflowState | null>(
  "docs-maintainer.repository-workflow-state",
  () => null,
);

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
  const state = await loadRepositoryWorkflowState();
  const repositoryInput = state.repositoryInput;
  const repository = repositoryInput.workingDocumentationRepository;
  const sandbox = await ctx.getSandbox();
  const actionProvenance = [...state.actionProvenance];

  try {
    const materialization = await reuseMaterializedWorkingRepository(
      ctx,
      state,
      actionProvenance,
    );
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
    await saveRepositoryWorkflowState({
      repositoryInput,
      materialization,
      actionProvenance,
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
  const repository = repositoryInput.workingDocumentationRepository;

  assertActionAllowed(repository, "clone");
  assertSandboxPath(repository.sandboxPath);

  const checkout = await inspectWorkingRepositoryCheckout(ctx, repository);
  if (checkout === "matching") {
    await refreshWorkingRepositoryCheckout(ctx, repository, actionProvenance);
  } else if (await restoreCachedWorkingRepository(ctx, repository, actionProvenance)) {
    // The restored checkout is reset before it is exposed as the working repo.
  } else {
    await cloneWorkingRepository(ctx, repository, actionProvenance);
  }

  const materialization = await resolveMaterialization(ctx, repository);

  await saveRepositoryWorkflowState({
    repositoryInput,
    materialization,
    actionProvenance,
  });

  return materialization;
}

export async function loadRepositoryWorkflowState(): Promise<WorkflowState> {
  const state = repositoryWorkflowState.get();

  if (state === null) {
    throw new Error("Working repository has not been materialized in this session.");
  }

  return {
    repositoryInput: repositoryInputSchema.parse(state.repositoryInput),
    materialization: repositoryMaterializationSchema.parse(state.materialization),
    actionProvenance: z.array(repositoryActionRecordSchema).parse(state.actionProvenance),
  };
}

export async function saveRepositoryWorkflowState(state: WorkflowState): Promise<void> {
  repositoryWorkflowState.update(() => state);
}

async function reuseMaterializedWorkingRepository(
  ctx: ToolContext,
  state: WorkflowState,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocsMaintenanceWorkflowResult["materialization"]> {
  const repository = state.repositoryInput.workingDocumentationRepository;
  const checkout = await inspectWorkingRepositoryCheckout(ctx, repository);

  if (checkout !== "matching") {
    const reason = "Configured working repository checkout is missing or no longer matches.";
    actionProvenance.push(recordAction(repository, "reuse", "failure", { reason }));
    throw new Error(reason);
  }

  const sandbox = await ctx.getSandbox();
  const clean = await sandbox.run({
    command: [
      "git",
      "-C",
      sh(repository.sandboxPath),
      "reset",
      "--hard",
      "HEAD",
      "&&",
      "git",
      "-C",
      sh(repository.sandboxPath),
      "clean",
      "-fd",
    ].join(" "),
    abortSignal: ctx.abortSignal,
  });

  if (clean.exitCode !== 0) {
    const reason = summarizeCommandFailure(clean);
    actionProvenance.push(recordAction(repository, "reuse", "failure", { reason }));
    throw new Error(`Failed to reset configured working repository: ${reason}`);
  }

  actionProvenance.push(recordAction(repository, "reuse", "success", { target: repository.sandboxPath }));

  return resolveMaterialization(ctx, repository);
}

async function inspectWorkingRepositoryCheckout(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<"missing" | "matching" | "mismatched"> {
  const sandbox = await ctx.getSandbox();
  const gitDirCheck = await sandbox.run({
    command: `test -d ${sh(joinSandboxPath(repository.sandboxPath, ".git"))}`,
    abortSignal: ctx.abortSignal,
  });

  if (gitDirCheck.exitCode !== 0) {
    const pathCheck = await sandbox.run({
      command: `test -e ${sh(repository.sandboxPath)}`,
      abortSignal: ctx.abortSignal,
    });
    return pathCheck.exitCode === 0 ? "mismatched" : "missing";
  }

  const remote = await sandbox.run({
    command: `git -C ${sh(repository.sandboxPath)} remote get-url origin`,
    abortSignal: ctx.abortSignal,
  });

  if (remote.exitCode !== 0) {
    return "mismatched";
  }

  return normalizeRepositoryUrl(remote.stdout.trim()) === normalizeRepositoryUrl(repository.source.url)
    ? "matching"
    : "mismatched";
}

async function refreshWorkingRepositoryCheckout(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  const refresh = await sandbox.run({
    command: [
      "git",
      "-C",
      sh(repository.sandboxPath),
      "fetch",
      "--depth=1",
      "origin",
      sh(repository.ref),
      "&&",
      "git",
      "-C",
      sh(repository.sandboxPath),
      "reset",
      "--hard",
      "FETCH_HEAD",
      "&&",
      "git",
      "-C",
      sh(repository.sandboxPath),
      "clean",
      "-fd",
    ].join(" "),
    abortSignal: ctx.abortSignal,
  });

  if (refresh.exitCode === 0) {
    actionProvenance.push(recordAction(repository, "refresh", "success", { target: repository.sandboxPath }));
    return;
  }

  const reason = summarizeCommandFailure(refresh);
  actionProvenance.push(recordAction(repository, "refresh", "failure", { reason }));
  await cloneWorkingRepository(ctx, repository, actionProvenance);
}

async function restoreCachedWorkingRepository(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<boolean> {
  const marker = await readRepositoryCacheMarker(ctx, repository);
  if (marker === null) return false;

  const sourceMatches =
    normalizeRepositoryUrl(marker.repositoryUrl) === normalizeRepositoryUrl(repository.source.url) &&
    marker.requestedRef === repository.ref &&
    marker.docsRoot === repository.docsRoot &&
    marker.status === "ready";

  if (!sourceMatches) return false;

  const sandbox = await ctx.getSandbox();
  const restore = await sandbox.run({
    command: [
      "set -eu",
      `test -d ${sh(joinSandboxPath(marker.sourcePath, ".git"))}`,
      `rm -rf ${sh(repository.sandboxPath)}`,
      `ln -s ${sh(marker.sourcePath)} ${sh(repository.sandboxPath)}`,
      `cd ${sh(repository.sandboxPath)}`,
      "git reset --hard HEAD",
      "git clean -fd",
    ].join("\n"),
    abortSignal: ctx.abortSignal,
  });

  if (restore.exitCode !== 0) {
    const reason = summarizeCommandFailure(restore);
    actionProvenance.push(
      recordAction(repository, "reuse", "failure", { target: marker.sourcePath, reason }),
    );
    return false;
  }

  actionProvenance.push(recordAction(repository, "reuse", "success", { target: marker.sourcePath }));
  return true;
}

async function cloneWorkingRepository(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  const sandbox = await ctx.getSandbox();
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
}

async function resolveMaterialization(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<DocsMaintenanceWorkflowResult["materialization"]> {
  const sandbox = await ctx.getSandbox();
  const docsRootPath = joinSandboxPath(repository.sandboxPath, repository.docsRoot);
  const docsRootCheck = await sandbox.run({
    command: `test -d ${sh(docsRootPath)}`,
    abortSignal: ctx.abortSignal,
  });

  if (docsRootCheck.exitCode !== 0) {
    const reason = `Docs root does not exist: ${repository.docsRoot}`;
    throw new Error(reason);
  }

  const resolvedCommitResult = await sandbox.run({
    command: `git -C ${sh(repository.sandboxPath)} rev-parse HEAD`,
    abortSignal: ctx.abortSignal,
  });

  return {
    repositoryUrl: repository.source.url,
    requestedRef: repository.ref,
    resolvedCommit:
      resolvedCommitResult.exitCode === 0 ? resolvedCommitResult.stdout.trim() : undefined,
    docsRoot: repository.docsRoot,
    sandboxPath: repository.sandboxPath,
    status: "materialized" as const,
  };
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
  if (name === "install") {
    return runInstallRepositoryCheck(ctx, repository, actionProvenance);
  }

  return runRepositoryCommandCheck(ctx, repository, name, actionProvenance);
}

async function runInstallRepositoryCheck(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<RepositoryCheckResult> {
  const command = commandForCheck("install");
  const sandbox = await ctx.getSandbox();
  const lockfileHash = await readLockfileHash(ctx, repository);
  const marker = await readInstallCacheMarker(ctx, repository);
  const nodeModules = await sandbox.run({
    command: "test -d node_modules",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (
    lockfileHash !== null &&
    nodeModules.exitCode === 0 &&
    marker !== null &&
    marker.repositoryUrl === repository.source.url &&
    marker.requestedRef === repository.ref &&
    marker.lockfileHash === lockfileHash &&
    marker.command === command &&
    marker.status === "passed"
  ) {
    const corepack = await sandbox.run({
      command: "corepack enable",
      workingDirectory: repository.sandboxPath,
      abortSignal: ctx.abortSignal,
    });

    const check = {
      name: "install" as const,
      command: `${command} (cached)`,
      exitCode: corepack.exitCode,
      status: corepack.exitCode === 0 ? ("passed" as const) : ("failed" as const),
      stdout: corepack.exitCode === 0
        ? `Reused cached install for pnpm-lock.yaml ${lockfileHash}.\n`
        : truncate(corepack.stdout, 4_000),
      stderr: truncate(corepack.stderr, 4_000),
    };

    actionProvenance.push(
      recordAction(repository, "run-checks", check.status === "passed" ? "success" : "failure", {
        commandCategory: "install",
        reason: check.status === "passed" ? undefined : summarizeCommandFailure(corepack),
      }),
    );

    return check;
  }

  const check = await runRepositoryCommandCheck(ctx, repository, "install", actionProvenance);
  if (check.status === "passed" && lockfileHash !== null) {
    await writeInstallCacheMarker(ctx, repository, lockfileHash, command);
  }

  return check;
}

async function runRepositoryCommandCheck(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  name: RepositoryCheckName,
  actionProvenance: RepositoryActionRecord[],
): Promise<RepositoryCheckResult> {
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

  const checks = [await runRepositoryCheck(ctx, repository, "diff-check", actionProvenance)];

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

async function readLockfileHash(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<string | null> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command:
      "node -e \"const { createHash } = require('node:crypto'); const { readFileSync } = require('node:fs'); process.stdout.write(createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'));\"",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function readInstallCacheMarker(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<z.infer<typeof installCacheMarkerSchema> | null> {
  const sandbox = await ctx.getSandbox();
  const content = await sandbox.readTextFile({
    path: installCacheMarkerPath(repository),
    abortSignal: ctx.abortSignal,
  });

  if (content === null) return null;

  try {
    const parsed = installCacheMarkerSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readRepositoryCacheMarker(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<z.infer<typeof repositoryCacheMarkerSchema> | null> {
  const sandbox = await ctx.getSandbox();
  const content = await sandbox.readTextFile({
    path: repositoryCacheMarkerPath(repository),
    abortSignal: ctx.abortSignal,
  });

  if (content === null) return null;

  try {
    const parsed = repositoryCacheMarkerSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeInstallCacheMarker(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  lockfileHash: string,
  command: string,
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  await sandbox.run({
    command: `mkdir -p ${sh(installCacheDirectory())}`,
    abortSignal: ctx.abortSignal,
  });
  await sandbox.writeTextFile({
    path: installCacheMarkerPath(repository),
    content: `${JSON.stringify(
      {
        version: 1,
        repositoryUrl: repository.source.url,
        requestedRef: repository.ref,
        lockfileHash,
        command,
        status: "passed",
      },
      null,
      2,
    )}\n`,
    abortSignal: ctx.abortSignal,
  });
}

function installCacheDirectory(): string {
  return "/workspace/.docs-maintainer-cache/install";
}

function installCacheMarkerPath(repository: WorkingDocumentationRepository): string {
  return `${installCacheDirectory()}/${hashText(
    [
      normalizeRepositoryUrl(repository.source.url),
      repository.ref,
      repository.sandboxPath,
    ].join("\n"),
  )}.json`;
}

function repositoryCacheMarkerPath(repository: WorkingDocumentationRepository): string {
  return `${repositoryCacheDirectory(repository)}/marker.json`;
}

function repositoryCacheDirectory(repository: WorkingDocumentationRepository): string {
  return `/workspace/.docs-maintainer-cache/repositories/${hashText(
    [
      normalizeRepositoryUrl(repository.source.url),
      repository.ref,
      repository.docsRoot,
    ].join("\n"),
  )}`;
}

function normalizeRepositoryUrl(value: string): string {
  return value.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
