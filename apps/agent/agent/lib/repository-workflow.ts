import { createHash } from "node:crypto";

import { defineState } from "eve/context";
import type { SandboxCommandResult } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { legacyImpactDecisionSchema } from "./docs-impact-decision.js";
import {
  formatUnknownError,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  resolveGitHubAppInstallationToken,
  resolveGitHubConnector,
  type GitHubRepositorySlug,
} from "./github-app-client.js";
import {
  repositoryInputSchema,
  type ExternalContext,
  type RepositoryInput,
  type ResolvedRepositoryInput,
  type ResolvedWorkingDocumentationRepository,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";
import { readSetupState, requireSetupReady, saveWorkingRepositorySetup } from "./setup-state.js";

export const repositoryCheckNameSchema = z.enum([
  "install",
  "build",
  "diff-check",
  "diff-quiet",
  "status",
]);

export const impactDecisionSchema = legacyImpactDecisionSchema;

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

const docsRootDetectionResultSchema = z.object({
  docsRoot: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  candidates: z
    .array(
      z.object({
        path: z.string().trim().min(1),
        score: z.number(),
        reason: z.string().trim().min(1),
      }),
    )
    .default([]),
});

type ScenarioKind = DocsMaintenanceWorkflowResult["scenarioKind"];
type DocsRootDetectionResult = z.infer<typeof docsRootDetectionResultSchema>;

export interface WorkflowState {
  repositoryInput: ResolvedRepositoryInput;
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  actionProvenance: RepositoryActionRecord[];
  lastResult?: DocsMaintenanceWorkflowResult;
}

const repositoryWorkflowState = defineState<WorkflowState | null>(
  "docs-agent.repository-workflow-state",
  () => null,
);
const configuredRepositoryInputState = defineState<RepositoryInput | null>(
  "docs-agent.configured-repository-input",
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
  const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
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
      path: ".docs-agent/last-result.json",
      content: `${JSON.stringify(result, null, 2)}\n`,
    });
    await saveRepositoryWorkflowState({
      repositoryInput,
      materialization,
      actionProvenance,
      lastResult: result,
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
    await refreshWorkingRepositoryCheckout(ctx, repository, actionProvenance);
  } else {
    await cloneWorkingRepository(ctx, repository, actionProvenance);
  }

  const resolvedRepository = await resolveWorkingRepositoryDocsRoot(
    ctx,
    repository,
    actionProvenance,
  );
  const resolvedRepositoryInput: ResolvedRepositoryInput = {
    ...repositoryInput,
    workingDocumentationRepository: resolvedRepository,
  };
  const materialization = await resolveMaterialization(ctx, resolvedRepository);
  await cacheResolvedWorkingRepository(ctx, resolvedRepository, materialization, actionProvenance);

  await saveRepositoryWorkflowState({
    repositoryInput: resolvedRepositoryInput,
    materialization,
    actionProvenance,
  });

  return materialization;
}

export async function saveConfiguredRepositoryInput(input: RepositoryInput): Promise<void> {
  const parsed = repositoryInputSchema.parse(input);
  configuredRepositoryInputState.update(() => parsed);
}

export async function validateWorkingRepositorySetup(
  repositoryInput: RepositoryInput,
  abortSignal?: AbortSignal,
): Promise<RepositoryActionRecord[]> {
  const parsed = repositoryInputSchema.parse(repositoryInput);
  const repository = parsed.workingDocumentationRepository;
  assertActionAllowed(repository, "clone");
  assertSandboxPath(repository.sandboxPath);

  const slug = parseGitHubRepositoryUrl(repository.source.url);
  const token = await resolveRepositoryValidationToken(slug);
  await assertGitHubRepositoryExists(token, slug, abortSignal);
  await assertGitHubRefExists(token, slug, repository.ref, abortSignal);
  if (repository.docsRoot !== undefined) {
    await assertGitHubDirectoryExists(
      token,
      slug,
      repository.ref,
      repository.docsRoot,
      abortSignal,
    );
  }

  return [
    recordAction(repository, "validate", "success", {
      target: `${repository.source.url}#${repository.ref}`,
    }),
  ];
}

async function resolveRepositoryValidationToken(slug: GitHubRepositorySlug): Promise<string> {
  const setup = await readSetupState().catch(() => null);
  const connector = resolveGitHubConnector(setup);
  if (connector === "") {
    throw new Error(
      "Could not validate GitHub repository with app-scoped credentials: no GitHub connector is configured.",
    );
  }

  try {
    const tokenResponse = await resolveGitHubAppInstallationToken({ connector, slug });
    return tokenResponse.token;
  } catch (error) {
    throw new Error(
      `Could not validate GitHub repository with app-scoped credentials from connector ${connector}: ${formatUnknownError(error)}`,
    );
  }
}

export async function loadRepositoryWorkflowState(): Promise<WorkflowState> {
  const state = repositoryWorkflowState.get();

  if (state === null) {
    throw new Error("Working repository has not been materialized in this session.");
  }

  const repositoryInput = parseResolvedRepositoryInput(state.repositoryInput);

  return {
    repositoryInput,
    materialization: repositoryMaterializationSchema.parse(state.materialization),
    actionProvenance: z.array(repositoryActionRecordSchema).parse(state.actionProvenance),
    lastResult:
      state.lastResult === undefined
        ? undefined
        : docsMaintenanceWorkflowResultSchema.parse(state.lastResult),
  };
}

export async function loadOrMaterializeRepositoryWorkflowState(
  ctx: ToolContext,
): Promise<WorkflowState> {
  try {
    return await loadRepositoryWorkflowState();
  } catch {
    const setup = await requireSetupReady("docs-maintenance");
    const configuredInput = configuredRepositoryInputState.get();
    const repositoryInput = materializationInputForSetup(
      configuredInput,
      setup.workingRepositoryInput,
    );
    const materialization = await materializeWorkingRepository(ctx, repositoryInput, []);
    if (
      setup.workingRepositoryInput.workingDocumentationRepository.docsRoot !==
      materialization.docsRoot
    ) {
      await saveWorkingRepositorySetup({
        ...setup.workingRepositoryInput,
        workingDocumentationRepository: {
          ...setup.workingRepositoryInput.workingDocumentationRepository,
          docsRoot: materialization.docsRoot,
        },
      });
    }
    return loadRepositoryWorkflowState();
  }
}

export async function saveRepositoryWorkflowState(state: WorkflowState): Promise<void> {
  repositoryWorkflowState.update(() => state);
}

function parseResolvedRepositoryInput(input: unknown): ResolvedRepositoryInput {
  const parsed = repositoryInputSchema.parse(input);
  const { docsRoot } = parsed.workingDocumentationRepository;

  if (docsRoot === undefined) {
    throw new Error("Working repository docs root has not been resolved in this session.");
  }

  return {
    ...parsed,
    workingDocumentationRepository: {
      ...parsed.workingDocumentationRepository,
      docsRoot,
    },
  };
}

function materializationInputForSetup(
  configuredInput: RepositoryInput | null,
  setupInput: RepositoryInput,
): RepositoryInput {
  if (
    configuredInput === null ||
    !sameWorkingRepositoryTarget(
      configuredInput.workingDocumentationRepository,
      setupInput.workingDocumentationRepository,
    )
  ) {
    return setupInput;
  }

  const setupDocsRoot = setupInput.workingDocumentationRepository.docsRoot;
  if (
    configuredInput.workingDocumentationRepository.docsRoot !== undefined ||
    setupDocsRoot === undefined
  ) {
    return configuredInput;
  }

  return {
    ...configuredInput,
    workingDocumentationRepository: {
      ...configuredInput.workingDocumentationRepository,
      docsRoot: setupDocsRoot,
    },
  };
}

function sameWorkingRepositoryTarget(
  left: WorkingDocumentationRepository,
  right: WorkingDocumentationRepository,
): boolean {
  return (
    normalizeRepositoryUrl(left.source.url) === normalizeRepositoryUrl(right.source.url) &&
    left.ref === right.ref &&
    left.sandboxPath === right.sandboxPath
  );
}

async function resolveWorkingRepositoryDocsRoot(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<ResolvedWorkingDocumentationRepository> {
  if (repository.docsRoot !== undefined) {
    return withResolvedDocsRoot(repository, repository.docsRoot);
  }

  const detection = await detectDocsRoot(ctx, repository, actionProvenance);
  const resolvedRepository = withResolvedDocsRoot(repository, detection.docsRoot);

  actionProvenance.push(
    recordAction(resolvedRepository, "detect-docs-root", "success", {
      target: detection.docsRoot,
      reason: detection.reason,
    }),
  );

  return resolvedRepository;
}

async function detectDocsRoot(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocsRootDetectionResult> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: nodeStdinCommand(`
const fs = require("node:fs");
const path = require("node:path");

const ignored = new Set([
  ".git",
  ".docusaurus",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const configNames = new Set([
  "docusaurus.config.js",
  "docusaurus.config.cjs",
  "docusaurus.config.mjs",
  "docusaurus.config.ts",
]);

function normalizeRel(value) {
  const normalized = path.posix.normalize(value || ".");
  if (normalized === "." || normalized === "") return ".";
  return normalized.replace(/^\\.\\//, "");
}

function joinRel(root, child) {
  return normalizeRel(root === "." ? child : path.posix.join(root, child));
}

function abs(rel) {
  return path.join(process.cwd(), rel === "." ? "" : rel);
}

function safeEntries(rel) {
  try {
    return fs.readdirSync(abs(rel), { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(rel) {
  try {
    return fs.statSync(abs(rel)).isDirectory();
  } catch {
    return false;
  }
}

function hasMarkdown(rel, maxDepth = 4, depth = 0) {
  if (!isDirectory(rel) || depth > maxDepth) return false;

  for (const entry of safeEntries(rel)) {
    if (ignored.has(entry.name)) continue;

    const child = joinRel(rel, entry.name);
    if (entry.isFile() && /\\.(md|mdx)$/i.test(entry.name)) {
      return true;
    }

    if (entry.isDirectory() && hasMarkdown(child, maxDepth, depth + 1)) {
      return true;
    }
  }

  return false;
}

function hasSidebar(rel) {
  return safeEntries(rel).some(
    (entry) => entry.isFile() && /^sidebars\\.(js|cjs|mjs|ts)$/i.test(entry.name),
  );
}

function docusaurusConfigFiles(rel) {
  return safeEntries(rel)
    .filter((entry) => entry.isFile() && configNames.has(entry.name))
    .map((entry) => joinRel(rel, entry.name));
}

function collectDirs(rel = ".", depth = 0, out = []) {
  if (!isDirectory(rel) || depth > 2) return out;
  out.push(rel);

  for (const entry of safeEntries(rel)) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    collectDirs(joinRel(rel, entry.name), depth + 1, out);
  }

  return out;
}

function configuredDocPaths(configFile) {
  let text = "";
  try {
    text = fs.readFileSync(abs(configFile), "utf8");
  } catch {
    return [];
  }

  return Array.from(text.matchAll(/\\bpath\\s*:\\s*["'\`]([^"'\`]+)["'\`]/g))
    .map((match) => match[1])
    .filter((value) => value && !value.startsWith("/") && !value.includes(".."));
}

const candidates = new Map();

function addCandidate(rel, score, reason) {
  const normalized = normalizeRel(rel);
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return;
  if (!isDirectory(normalized) || !hasMarkdown(normalized)) return;

  const existing = candidates.get(normalized);
  if (existing && existing.score >= score) return;
  candidates.set(normalized, { path: normalized, score, reason });
}

const dirs = collectDirs();

for (const rel of dirs) {
  const configs = docusaurusConfigFiles(rel);
  if (configs.length > 0) {
    for (const configFile of configs) {
      for (const configuredPath of configuredDocPaths(configFile)) {
        addCandidate(
          joinRel(rel, configuredPath),
          95,
          "Docusaurus config declares a docs plugin path.",
        );
      }
    }

    addCandidate(joinRel(rel, "docs"), 90, "Docusaurus project contains a docs directory.");
    addCandidate(joinRel(rel, "content/docs"), 85, "Docusaurus project contains content/docs.");
    if (hasSidebar(rel)) {
      addCandidate(rel, 70, "Docusaurus project has sidebars and Markdown at its root.");
    }
  }

  if (path.posix.basename(rel) === "docs") {
    addCandidate(rel, 80, "Directory is named docs and contains Markdown or MDX.");
  }

  if (hasSidebar(rel)) {
    addCandidate(rel, 65, "Directory has a Docusaurus sidebar and Markdown or MDX.");
  }
}

addCandidate("docs", 75, "Top-level docs directory contains Markdown or MDX.");
addCandidate("content/docs", 70, "Top-level content/docs directory contains Markdown or MDX.");

const sorted = Array.from(candidates.values()).sort(
  (left, right) => right.score - left.score || left.path.length - right.path.length,
);

if (sorted.length === 0) {
  console.error(
    "Could not detect a docs root. Expected a Docusaurus config, sidebars file, or docs directory containing Markdown or MDX.",
  );
  process.exit(2);
}

const [best] = sorted;
process.stdout.write(JSON.stringify({
  docsRoot: best.path,
  reason: best.reason,
  candidates: sorted,
}));
`),
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(
      recordAction(repository, "detect-docs-root", "failure", { reason }),
    );
    throw new Error(`Failed to detect docs root: ${reason}`);
  }

  try {
    return docsRootDetectionResultSchema.parse(JSON.parse(result.stdout));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    actionProvenance.push(
      recordAction(repository, "detect-docs-root", "failure", { reason }),
    );
    throw new Error(`Failed to parse detected docs root: ${reason}`);
  }
}

function withResolvedDocsRoot(
  repository: WorkingDocumentationRepository,
  docsRoot: string,
): ResolvedWorkingDocumentationRepository {
  return {
    ...repository,
    docsRoot,
  };
}

export async function reuseMaterializedWorkingRepository(
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
  if (repository.docsRoot === undefined) return false;

  const resolvedRepository = withResolvedDocsRoot(repository, repository.docsRoot);
  const marker = await readRepositoryCacheMarker(ctx, resolvedRepository);
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
      `rm -rf ${sh(resolvedRepository.sandboxPath)}`,
      `ln -s ${sh(marker.sourcePath)} ${sh(resolvedRepository.sandboxPath)}`,
      `cd ${sh(resolvedRepository.sandboxPath)}`,
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

  actionProvenance.push(
    recordAction(resolvedRepository, "reuse", "success", { target: marker.sourcePath }),
  );
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
  repository: ResolvedWorkingDocumentationRepository,
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

async function cacheResolvedWorkingRepository(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  materialization: DocsMaintenanceWorkflowResult["materialization"],
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  if (materialization.resolvedCommit === undefined) {
    actionProvenance.push(
      recordAction(repository, "cache", "failure", {
        reason: "Resolved commit was unavailable; repository cache was not marked ready.",
      }),
    );
    return;
  }

  const sandbox = await ctx.getSandbox();
  const cacheDirectory = repositoryCacheDirectory(repository);
  const cacheParent = repositoryCacheParentDirectory();
  const cachePromote = await sandbox.run({
    command: [
      "set -eu",
      `work_dir=${sh(repository.sandboxPath)}`,
      `cache_dir=${sh(cacheDirectory)}`,
      `cache_parent=${sh(cacheParent)}`,
      'if [ -L "$work_dir" ]; then exit 0; fi',
      'tmp_dir="${cache_dir}.tmp"',
      'rm -rf "$tmp_dir"',
      'mkdir -p "$cache_parent"',
      'mv "$work_dir" "$tmp_dir"',
      'rm -rf "$cache_dir"',
      'if mv "$tmp_dir" "$cache_dir" && ln -s "$cache_dir" "$work_dir"; then',
      "  exit 0",
      "fi",
      'rm -f "$work_dir"',
      'if [ -d "$cache_dir" ]; then',
      '  mv "$cache_dir" "$work_dir"',
      'elif [ -d "$tmp_dir" ]; then',
      '  mv "$tmp_dir" "$work_dir"',
      "fi",
      "exit 1",
    ].join("\n"),
    abortSignal: ctx.abortSignal,
  });

  if (cachePromote.exitCode !== 0) {
    actionProvenance.push(
      recordAction(repository, "cache", "failure", {
        target: cacheDirectory,
        reason: summarizeCommandFailure(cachePromote),
      }),
    );
    return;
  }

  await sandbox.writeTextFile({
    path: repositoryCacheMarkerPath(repository),
    content: `${JSON.stringify(
      {
        version: 1,
        repositoryUrl: repository.source.url,
        requestedRef: repository.ref,
        docsRoot: repository.docsRoot,
        sourcePath: cacheDirectory,
        resolvedCommit: materialization.resolvedCommit,
        status: "ready",
      },
      null,
      2,
    )}\n`,
    abortSignal: ctx.abortSignal,
  });

  actionProvenance.push(
    recordAction(repository, "cache", "success", { target: cacheDirectory }),
  );
}

export async function readRepositoryFile(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
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
  repository: ResolvedWorkingDocumentationRepository,
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
  repository: ResolvedWorkingDocumentationRepository,
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
  repository: ResolvedWorkingDocumentationRepository,
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
  repository: ResolvedWorkingDocumentationRepository,
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
  repository: ResolvedWorkingDocumentationRepository,
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
  repositoryInput: ResolvedRepositoryInput,
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
  repositoryInput: ResolvedRepositoryInput,
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
  repository: ResolvedWorkingDocumentationRepository,
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
  return "/workspace/.docs-agent-cache/install";
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

function repositoryCacheMarkerPath(repository: ResolvedWorkingDocumentationRepository): string {
  return `${repositoryCacheDirectory(repository)}/marker.json`;
}

function repositoryCacheParentDirectory(): string {
  return "/workspace/.docs-agent-cache/repositories";
}

function repositoryCacheDirectory(repository: ResolvedWorkingDocumentationRepository): string {
  return `${repositoryCacheParentDirectory()}/${hashText(
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

async function assertGitHubRepositoryExists(
  token: string,
  slug: GitHubRepositorySlug,
  abortSignal?: AbortSignal,
): Promise<void> {
  const result = await githubApiRequest<unknown>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`,
    abortSignal,
  });

  if (result.ok) return;
  if (result.status === 404) {
    throw new Error(
      `GitHub repository was not found or is not granted to the GitHub App installation: ${slug.owner}/${slug.repo}.`,
    );
  }

  throw new Error(`Could not validate GitHub repository: ${result.message}`);
}

async function assertGitHubRefExists(
  token: string,
  slug: GitHubRepositorySlug,
  ref: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const branch = await githubApiRequest<unknown>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/branches/${encodeURIComponent(ref)}`,
    abortSignal,
  });
  if (branch.ok) return;
  if (branch.status !== 404) {
    throw new Error(`Could not validate GitHub branch ${ref}: ${branch.message}`);
  }

  const tag = await githubApiRequest<unknown>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/git/ref/tags/${encodeURIComponent(ref)}`,
    abortSignal,
  });
  if (tag.ok) return;
  if (tag.status !== 404) {
    throw new Error(`Could not validate GitHub tag ${ref}: ${tag.message}`);
  }

  const commit = await githubApiRequest<unknown>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/commits/${encodeURIComponent(ref)}`,
    abortSignal,
  });
  if (commit.ok) return;
  if (commit.status === 404) {
    throw new Error(`GitHub ref was not found: ${slug.owner}/${slug.repo}#${ref}.`);
  }

  throw new Error(`Could not validate GitHub ref ${ref}: ${commit.message}`);
}

async function assertGitHubDirectoryExists(
  token: string,
  slug: GitHubRepositorySlug,
  ref: string,
  docsRoot: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const path =
    docsRoot === "."
      ? ""
      : `/${docsRoot.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  const result = await githubApiRequest<unknown>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/contents${path}?ref=${encodeURIComponent(ref)}`,
    abortSignal,
  });

  if (result.ok) {
    if (Array.isArray(result.body) || isGitHubDirectoryContent(result.body)) return;
    throw new Error(`Configured docs root is not a directory: ${docsRoot}.`);
  }

  if (result.status === 404) {
    throw new Error(`Configured docs root was not found at ${ref}: ${docsRoot}.`);
  }

  throw new Error(`Could not validate docs root ${docsRoot}: ${result.message}`);
}

function isGitHubDirectoryContent(value: unknown): value is { type: "dir" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "dir"
  );
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nodeStdinCommand(script: string): string {
  return `node <<'NODE'\n${script.trim()}\nNODE`;
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
