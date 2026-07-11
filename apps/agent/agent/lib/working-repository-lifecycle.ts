import { createHash } from "node:crypto";

import type { ToolContext } from "eve/tools";
import { z } from "zod";

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
  type RepositoryInput,
  type ResolvedRepositoryInput,
  type ResolvedWorkingDocumentationRepository,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";
import {
  assertRepositoryMaterializationAllowed,
  cloneRepositoryCheckout,
  joinSandboxPath,
  normalizeRepositoryUrl,
  quoteShellArgument as sh,
  recordRepositoryAction,
  resolveRepositoryCommit,
  summarizeCommandFailure,
  type RepositoryActionRecord,
  workingRepositoryMaterializationPolicy,
} from "./repository-materialization.js";
import {
  loadRepositoryWorkflowState,
  materializationInputForSetup,
  saveRepositoryWorkflowState,
} from "./repository-workflow-state.js";
import type {
  DocsMaintenanceWorkflowResult,
  WorkflowState,
} from "./repository-workflow-contract.js";
import { readSetupState, requireSetupReady, saveWorkingRepositorySetup } from "./setup-state.js";
import { ensureDocsProfile } from "./docs-profile.js";

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

type DocsRootDetectionResult = z.infer<typeof docsRootDetectionResultSchema>;

export async function materializeWorkingRepository(
  ctx: ToolContext,
  repositoryInput: RepositoryInput,
  actionProvenance: RepositoryActionRecord[] = [],
): Promise<DocsMaintenanceWorkflowResult["materialization"]> {
  const repository = repositoryInput.workingDocumentationRepository;
  assertRepositoryMaterializationAllowed(workingRepositoryMaterializationPolicy(repository));

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
  await ensureDocsProfile({
    ctx,
    repository: resolvedRepository,
    materialization,
  });

  return materialization;
}

export async function validateWorkingRepositorySetup(
  repositoryInput: RepositoryInput,
  abortSignal?: AbortSignal,
): Promise<RepositoryActionRecord[]> {
  const parsed = repositoryInputSchema.parse(repositoryInput);
  const repository = parsed.workingDocumentationRepository;
  assertRepositoryMaterializationAllowed(workingRepositoryMaterializationPolicy(repository));

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

export async function loadOrMaterializeRepositoryWorkflowState(
  ctx: ToolContext,
): Promise<WorkflowState> {
  try {
    return await loadRepositoryWorkflowState();
  } catch {
    const setup = await requireSetupReady("docs-maintenance");
    const repositoryInput = materializationInputForSetup(setup.workingRepositoryInput);
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
  await cloneRepositoryCheckout(
    ctx,
    workingRepositoryMaterializationPolicy(repository),
    actionProvenance,
  );
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

  return {
    repositoryUrl: repository.source.url,
    requestedRef: repository.ref,
    resolvedCommit: await resolveRepositoryCommit(ctx, repository.sandboxPath),
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

function recordAction(
  repository: WorkingDocumentationRepository,
  action: string,
  status: RepositoryActionRecord["status"],
  details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
): RepositoryActionRecord {
  return recordRepositoryAction(repository, action, status, details);
}
