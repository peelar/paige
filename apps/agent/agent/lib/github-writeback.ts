import { createHash } from "node:crypto";

import type { ToolContext } from "eve/tools";
import { z } from "zod";

import type { WorkingDocumentationRepository } from "./repository-contract.js";
import {
  exportRepositoryDiff,
  listChangedFiles,
} from "./repository-operations.js";
import type { RepositoryActionRecord } from "./repository-materialization.js";
import {
  repositoryCheckResultSchema,
  type DocsMaintenanceWorkflowResult,
} from "./repository-workflow-contract.js";
import {
  loadRepositoryWorkflowState,
  saveRepositoryWorkflowState,
} from "./repository-workflow-state.js";
import {
  preflightGitHubWritebackSetup,
  requireSetupReady,
  resolveGitHubConnector,
  resolveGitHubWritebackToken,
  type SetupState,
} from "./setup-state.js";
import {
  docsSignalDetailSchema,
  getDocsSignal,
  transitionDocsSignalLifecycle,
  type DocsSignalDetail,
} from "./docs-signals.js";
import {
  formatUnknownError,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  type GitHubRepositorySlug,
} from "./github-app-client.js";

const branchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) =>
      /^[A-Za-z0-9._/-]+$/.test(value) &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.includes("//") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !value.endsWith(".lock"),
    "Use a conservative Git branch name.",
  );

const generatedTextSchema = z.string().trim().min(1).max(2_000);

export const publishWorkingRepositoryPrInputSchema = z.object({
  baseBranch: branchNameSchema
    .optional()
    .describe("The GitHub branch to target. Defaults to the configured repository ref."),
  branchName: branchNameSchema
    .optional()
    .describe("Optional branch name to create. Defaults to a deterministic docs-agent branch."),
  title: generatedTextSchema
    .optional()
    .describe("Optional PR title override. Omit it unless the user supplied one."),
  commitMessage: generatedTextSchema
    .optional()
    .describe("Optional commit message override. Omit it unless the user supplied one."),
  signalId: z.string().trim().min(1).optional()
    .describe("Originating docs signal id, when publishing a signal-backed prepared patch."),
});

export const publishWorkingRepositoryPrOutputSchema = z.object({
  published: z.literal(true),
  repository: z.string(),
  baseBranch: z.string(),
  branchName: z.string(),
  baseSha: z.string(),
  commitSha: z.string(),
  treeSha: z.string(),
  diffHash: z.string(),
  changedFiles: z.array(z.string()),
  checks: z.array(repositoryCheckResultSchema),
  pullRequest: z.object({
    number: z.number(),
    url: z.string().url(),
    draft: z.boolean(),
  }),
  signal: docsSignalDetailSchema.optional(),
  approvalPolicy: z.literal("always"),
  credentialProvider: z.literal("vercel-connect-app-scoped"),
});

export type PublishWorkingRepositoryPrInput = z.infer<
  typeof publishWorkingRepositoryPrInputSchema
>;
export type PublishWorkingRepositoryPrOutput = z.infer<
  typeof publishWorkingRepositoryPrOutputSchema
>;

interface GitHubRefResponse {
  ref: string;
  object: {
    sha: string;
    type: string;
  };
}

interface GitHubGitCommitResponse {
  sha: string;
  tree: {
    sha: string;
  };
}

interface GitHubTreeResponse {
  sha: string;
}

interface GitHubPullResponse {
  number: number;
  html_url: string;
  draft?: boolean;
}

interface ChangedFileEntry {
  path: string;
  mode: "100644" | "100755";
  content: string;
}

export class GitHubWritebackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubWritebackError";
  }
}

export async function publishWorkingRepositoryPr(
  input: PublishWorkingRepositoryPrInput,
  ctx: ToolContext,
): Promise<PublishWorkingRepositoryPrOutput> {
  const setup = await requireSetupReady("github-writeback");
  const setupStatus = await preflightGitHubWritebackSetup(ctx, setup);
  if (!setupStatus.githubWritebackReady) {
    throw new GitHubWritebackError(
      `GitHub writeback setup is not ready: ${setupStatus.githubWriteback.preflight.message}`,
    );
  }

  const state = await loadRepositoryWorkflowState();
  const repository = state.repositoryInput.workingDocumentationRepository;

  try {
    assertPublishAllowed(repository);

    const preparedResult = state.lastResult;
    if (preparedResult === undefined) {
      throw new GitHubWritebackError(
        "No prepared docs-maintenance workflow result exists in this session. Run the patch/check/diff workflow before publishing.",
      );
    }

    assertPreparedResultIsPublishable(preparedResult, repository);

    const currentChangedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
    const currentDiff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
    assertDiffMatchesPreparedResult(preparedResult, currentChangedFiles, currentDiff);

    await assertNoUnsupportedWorkingTreeState(ctx, repository);

    const changedFileEntries = await collectChangedFileEntries(
      ctx,
      repository,
      currentChangedFiles,
    );
    const slug = parseGitHubRepositoryUrl(repository.source.url);
    const baseBranch = normalizeBranchName(input.baseBranch ?? repository.ref);
    const baseSha = preparedResult.materialization.resolvedCommit;
    if (baseSha === undefined) {
      throw new GitHubWritebackError(
        "Cannot publish because the workflow did not record the resolved base commit.",
      );
    }

    const diffHash = hashText(currentDiff);
    const branchName = normalizeBranchName(
      input.branchName ?? buildDefaultBranchName(baseBranch, baseSha, diffHash),
    );
    const title = normalizePullRequestTitle(
      input.title ?? buildDefaultPullRequestTitle(preparedResult),
    );
    const commitMessage = normalizeCommitMessage(
      input.commitMessage ?? buildDefaultCommitMessage(preparedResult),
    );
    const originatingSignal = input.signalId === undefined
      ? undefined
      : await readPublishableSignal(input.signalId);
    const body = buildPullRequestBody({
      result: preparedResult,
      baseBranch,
      branchName,
      diffHash,
      changedFiles: currentChangedFiles,
      signal: originatingSignal,
    });

    const token = await resolveGitHubToken(setup, slug);
    const published = await createGitHubDraftPullRequest({
      token,
      slug,
      baseBranch,
      baseSha,
      branchName,
      commitMessage,
      title,
      body,
      changedFiles: changedFileEntries,
      abortSignal: ctx.abortSignal,
    });

    state.actionProvenance.push(
      recordPublishAction(repository, "success", {
        target: `${slug.owner}/${slug.repo}#${published.pullRequest.number}`,
      }),
    );
    await saveRepositoryWorkflowState(state);

    const updatedSignal = originatingSignal === undefined
      ? undefined
      : await transitionDocsSignalLifecycle({
          id: originatingSignal.id,
          status: "draft-pr-opened",
          reason: `Draft PR opened for prepared signal patch: ${published.pullRequest.url}`,
          actor: "docs-agent:github-writeback",
          links: [],
          artifacts: [
            {
              kind: "draft-pr",
              label: `Draft PR #${published.pullRequest.number}`,
              url: published.pullRequest.url,
              metadata: {
                repository: repository.source.url,
                branchName,
                baseBranch,
                commitSha: published.commitSha,
                diffHash,
              },
            },
          ],
          metadata: {
            pullRequest: published.pullRequest,
            branchName,
            baseBranch,
            diffHash,
          },
        }, "writeback");

    return {
      published: true,
      repository: repository.source.url,
      baseBranch,
      branchName,
      baseSha,
      commitSha: published.commitSha,
      treeSha: published.treeSha,
      diffHash,
      changedFiles: currentChangedFiles,
      checks: preparedResult.report.checks,
      pullRequest: published.pullRequest,
      signal: updatedSignal,
      approvalPolicy: "always",
      credentialProvider: "vercel-connect-app-scoped",
    };
  } catch (error) {
    state.actionProvenance.push(
      recordPublishAction(repository, "failure", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    await saveRepositoryWorkflowState(state);
    throw error;
  }
}

function assertPublishAllowed(repository: WorkingDocumentationRepository): void {
  if (!repository.allowedActions.includes("publish-pr")) {
    throw new GitHubWritebackError("Repository action is not allowed: publish-pr");
  }
}

function assertPreparedResultIsPublishable(
  result: DocsMaintenanceWorkflowResult,
  repository: WorkingDocumentationRepository,
): void {
  if (
    normalizeRepositoryUrl(result.materialization.repositoryUrl) !==
    normalizeRepositoryUrl(repository.source.url)
  ) {
    throw new GitHubWritebackError(
      "Prepared workflow result does not match the configured working documentation repository.",
    );
  }

  if (result.materialization.sandboxPath !== repository.sandboxPath) {
    throw new GitHubWritebackError(
      "Prepared workflow result does not match the configured working repository sandbox path.",
    );
  }

  if (result.noDiff || result.changedFiles.length === 0 || result.diff.trim() === "") {
    throw new GitHubWritebackError("No patch to publish: the prepared workflow result has no diff.");
  }

  if (result.report.checks.length === 0) {
    throw new GitHubWritebackError("Cannot publish without recorded check results.");
  }

  const failedChecks = result.report.checks.filter((check) => check.status !== "passed");
  if (failedChecks.length > 0) {
    throw new GitHubWritebackError(
      `Cannot publish because checks failed: ${failedChecks.map((check) => check.name).join(", ")}.`,
    );
  }

  if (!result.ok) {
    throw new GitHubWritebackError("Cannot publish because the prepared workflow result is not ok.");
  }
}

function assertDiffMatchesPreparedResult(
  result: DocsMaintenanceWorkflowResult,
  currentChangedFiles: string[],
  currentDiff: string,
): void {
  if (!sameStringSet(result.changedFiles, currentChangedFiles) || result.diff !== currentDiff) {
    throw new GitHubWritebackError(
      "Current sandbox diff does not match the prepared workflow result. Re-run the patch/check/diff workflow before publishing.",
    );
  }
}

async function assertNoUnsupportedWorkingTreeState(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: "git status --porcelain=v1 --untracked-files=all --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new GitHubWritebackError(
      `Could not inspect working tree before publish: ${summarizeCommandFailure(result)}.`,
    );
  }

  for (const line of result.stdout.split("\n").filter(Boolean)) {
    if (line.startsWith("?? ")) {
      throw new GitHubWritebackError(
        "Cannot publish while untracked files are present in the working repository.",
      );
    }

    if (line.length >= 2 && line[0] !== " ") {
      throw new GitHubWritebackError(
        "Cannot publish staged changes. The publish tool only exports the prepared unstaged sandbox diff.",
      );
    }
  }
}

async function collectChangedFileEntries(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  changedFiles: string[],
): Promise<ChangedFileEntry[]> {
  const sandbox = await ctx.getSandbox();
  const statusResult = await sandbox.run({
    command: "git diff --name-status --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (statusResult.exitCode !== 0) {
    throw new GitHubWritebackError(
      `Could not inspect changed file status: ${summarizeCommandFailure(statusResult)}.`,
    );
  }

  const binaryResult = await sandbox.run({
    command: "git diff --numstat --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (binaryResult.exitCode !== 0) {
    throw new GitHubWritebackError(
      `Could not inspect diff file types: ${summarizeCommandFailure(binaryResult)}.`,
    );
  }

  for (const line of binaryResult.stdout.split("\n").filter(Boolean)) {
    const [added, removed, path] = line.split("\t");
    if (added === "-" && removed === "-") {
      throw new GitHubWritebackError(`Cannot publish binary file changes: ${path}.`);
    }
  }

  const statusByPath = parseNameStatus(statusResult.stdout);
  if (!sameStringSet([...statusByPath.keys()], changedFiles)) {
    throw new GitHubWritebackError(
      "Changed-file status does not match the prepared workflow result.",
    );
  }

  const entries: ChangedFileEntry[] = [];
  for (const path of changedFiles) {
    assertRepositoryRelativePath(path);
    const status = statusByPath.get(path);
    if (status !== "M" && status !== "A") {
      throw new GitHubWritebackError(
        `Cannot publish ${status ?? "unknown"} change for ${path}. Only text additions and modifications are supported in this writeback slice.`,
      );
    }

    const content = await sandbox.readTextFile({
      path: joinSandboxPath(repository.sandboxPath, path),
      abortSignal: ctx.abortSignal,
    });
    if (content === null) {
      throw new GitHubWritebackError(`Changed file no longer exists in the sandbox: ${path}.`);
    }

    const mode = await readGitFileMode(ctx, repository, path);
    entries.push({ path, mode, content });
  }

  return entries;
}

function parseNameStatus(output: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of output.split("\n").filter(Boolean)) {
    const [rawStatus, ...paths] = line.split("\t");
    const status = rawStatus.slice(0, 1);
    if (status === "R" || status === "C") {
      const nextPath = paths.at(-1);
      if (nextPath !== undefined) result.set(nextPath, status);
      continue;
    }

    const path = paths[0];
    if (path !== undefined) result.set(path, status);
  }

  return result;
}

async function readGitFileMode(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  path: string,
): Promise<ChangedFileEntry["mode"]> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: `git ls-files -s -- ${sh(path)}`,
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new GitHubWritebackError(
      `Could not inspect Git file mode for ${path}: ${summarizeCommandFailure(result)}.`,
    );
  }

  const mode = result.stdout.trim().split(/\s+/, 1)[0];
  if (mode === "100644" || mode === "100755") return mode;

  if (mode === "") return "100644";

  throw new GitHubWritebackError(
    `Cannot publish unsupported Git file mode ${mode} for ${path}.`,
  );
}

async function resolveGitHubToken(
  setup: SetupState,
  slug: GitHubRepositorySlug,
): Promise<string> {
  const connector = resolveGitHubConnector(setup);
  try {
    const result = await resolveGitHubWritebackToken({ connector, slug });

    return result.token;
  } catch (error) {
    throw new GitHubWritebackError(
      `Could not resolve app-scoped GitHub credentials from Vercel Connect connector ${connector}: ${formatUnknownError(error)}`,
    );
  }
}

async function createGitHubDraftPullRequest(input: {
  token: string;
  slug: GitHubRepositorySlug;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  commitMessage: string;
  title: string;
  body: string;
  changedFiles: ChangedFileEntry[];
  abortSignal: AbortSignal;
}): Promise<{
  treeSha: string;
  commitSha: string;
  pullRequest: PublishWorkingRepositoryPrOutput["pullRequest"];
}> {
  const { token, slug, abortSignal } = input;
  const baseRef = await githubRequest<GitHubRefResponse | null>({
    token,
    method: "GET",
    path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/ref/heads/${encodeGitRefPath(input.baseBranch)}`,
    abortSignal,
    notFound: null,
  });

  if (baseRef === null) {
    throw new GitHubWritebackError(`Base branch does not exist on GitHub: ${input.baseBranch}.`);
  }

  if (baseRef.object.sha !== input.baseSha) {
    throw new GitHubWritebackError(
      `Base branch moved since the sandbox workflow ran. Expected ${input.baseSha}, found ${baseRef.object.sha}. Re-run the workflow before publishing.`,
    );
  }

  const baseCommit = await githubRequest<GitHubGitCommitResponse>({
    token,
    method: "GET",
    path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/commits/${encodePathPart(input.baseSha)}`,
    abortSignal,
  });
  const baseTreeSha = getGitCommitTreeSha(baseCommit, "base");

  const tree = await githubRequest<GitHubTreeResponse>({
    token,
    method: "POST",
    path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/trees`,
    abortSignal,
    body: {
      base_tree: baseTreeSha,
      tree: input.changedFiles.map((file) => ({
        path: file.path,
        mode: file.mode,
        type: "blob",
        content: file.content,
      })),
    },
  });

  const existingBranch = await githubRequest<GitHubRefResponse | null>({
    token,
    method: "GET",
    path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/ref/heads/${encodeGitRefPath(input.branchName)}`,
    abortSignal,
    notFound: null,
  });

  if (existingBranch !== null) {
    const existingCommit = await githubRequest<GitHubGitCommitResponse>({
      token,
      method: "GET",
      path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/commits/${encodePathPart(existingBranch.object.sha)}`,
      abortSignal,
    });
    const existingTreeSha = getGitCommitTreeSha(existingCommit, "existing branch");

    if (existingTreeSha !== tree.sha) {
      throw new GitHubWritebackError(
        `Branch already exists on GitHub with different content: ${input.branchName}.`,
      );
    }

    const existingPullRequest = await findExistingPullRequest({
      token,
      slug,
      baseBranch: input.baseBranch,
      branchName: input.branchName,
      abortSignal,
    });

    if (existingPullRequest !== null) {
      return {
        treeSha: existingTreeSha,
        commitSha: existingBranch.object.sha,
        pullRequest: normalizePullResponse(existingPullRequest),
      };
    }

    const pullRequest = await createPullRequest({
      token,
      slug,
      baseBranch: input.baseBranch,
      branchName: input.branchName,
      title: input.title,
      body: input.body,
      abortSignal,
    });

    return {
      treeSha: existingTreeSha,
      commitSha: existingBranch.object.sha,
      pullRequest: normalizePullResponse(pullRequest),
    };
  }

  const commit = await githubRequest<GitHubGitCommitResponse>({
    token,
    method: "POST",
    path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/commits`,
    abortSignal,
    body: {
      message: input.commitMessage,
      tree: tree.sha,
      parents: [input.baseSha],
    },
  });

  await githubRequest<GitHubRefResponse>({
    token,
    method: "POST",
    path: `/repos/${encodePathPart(slug.owner)}/${encodePathPart(slug.repo)}/git/refs`,
    abortSignal,
    body: {
      ref: `refs/heads/${input.branchName}`,
      sha: commit.sha,
    },
  });

  const pullRequest = await createPullRequest({
    token,
    slug,
    baseBranch: input.baseBranch,
    branchName: input.branchName,
    title: input.title,
    body: input.body,
    abortSignal,
  });

  return {
    treeSha: tree.sha,
    commitSha: commit.sha,
    pullRequest: normalizePullResponse(pullRequest),
  };
}

function getGitCommitTreeSha(commit: GitHubGitCommitResponse, description: string): string {
  if (typeof commit.tree?.sha !== "string" || commit.tree.sha.trim() === "") {
    throw new GitHubWritebackError(
      `GitHub ${description} commit response did not include a tree SHA.`,
    );
  }

  return commit.tree.sha;
}

async function findExistingPullRequest(input: {
  token: string;
  slug: GitHubRepositorySlug;
  baseBranch: string;
  branchName: string;
  abortSignal: AbortSignal;
}): Promise<GitHubPullResponse | null> {
  const pulls = await githubRequest<GitHubPullResponse[]>({
    token: input.token,
    method: "GET",
    path:
      `/repos/${encodePathPart(input.slug.owner)}/${encodePathPart(input.slug.repo)}/pulls` +
      `?state=open&head=${encodeURIComponent(`${input.slug.owner}:${input.branchName}`)}` +
      `&base=${encodeURIComponent(input.baseBranch)}&per_page=10`,
    abortSignal: input.abortSignal,
  });

  return pulls[0] ?? null;
}

async function createPullRequest(input: {
  token: string;
  slug: GitHubRepositorySlug;
  baseBranch: string;
  branchName: string;
  title: string;
  body: string;
  abortSignal: AbortSignal;
}): Promise<GitHubPullResponse> {
  return githubRequest<GitHubPullResponse>({
    token: input.token,
    method: "POST",
    path: `/repos/${encodePathPart(input.slug.owner)}/${encodePathPart(input.slug.repo)}/pulls`,
    abortSignal: input.abortSignal,
    body: {
      title: input.title,
      body: input.body,
      head: input.branchName,
      base: input.baseBranch,
      draft: true,
    },
  });
}

function normalizePullResponse(
  pullRequest: GitHubPullResponse,
): PublishWorkingRepositoryPrOutput["pullRequest"] {
  return {
    number: pullRequest.number,
    url: pullRequest.html_url,
    draft: pullRequest.draft ?? true,
  };
}

async function githubRequest<T>(input: {
  token: string;
  method: "GET" | "POST";
  path: string;
  abortSignal: AbortSignal;
  body?: unknown;
  notFound?: null;
}): Promise<T> {
  const result = await githubApiRequest<T>({
    token: input.token,
    method: input.method,
    path: input.path,
    abortSignal: input.abortSignal,
    body: input.body,
  });

  if (!result.ok && result.status === 404 && input.notFound === null) {
    return null as T;
  }

  if (!result.ok) {
    throw new GitHubWritebackError(
      `GitHub ${input.method} ${input.path} failed with ${result.status}: ${truncateOneLine(result.message, 1_000)}`,
    );
  }

  return result.body;
}

export function buildDefaultBranchName(
  baseBranch: string,
  baseSha: string,
  diffHash: string,
): string {
  const baseSlug = slugifyBranchSegment(baseBranch);
  return branchNameSchema.parse(
    `docs-agent/${baseSlug}/${baseSha.slice(0, 8)}-${diffHash.slice(0, 12)}`,
  );
}

export function buildPullRequestBody(input: {
  result: DocsMaintenanceWorkflowResult;
  baseBranch: string;
  branchName: string;
  diffHash: string;
  changedFiles: string[];
  signal?: DocsSignalDetail;
}): string {
  const { result } = input;
  const checks = result.report.checks.map(
    (check) => `- ${check.name}: ${check.status} (${check.command})`,
  );
  const signalSection = input.signal === undefined
    ? []
    : [
        "## Originating Signal",
        "",
        `- Signal ID: ${input.signal.id}`,
        `- Signal status before publish: ${input.signal.status}`,
        `- Summary: ${input.signal.sourceSummary}`,
        ...input.signal.sources.map((source) =>
          `- Source: ${source.kind}${source.permalink === null ? "" : ` (${source.permalink})`}`,
        ),
        "",
      ];

  return [
    "## Documentation Impact Report",
    "",
    `Decision: ${result.report.decision}`,
    `Proposed action: ${result.report.proposedAction}`,
    `Patch summary: ${result.report.patchSummary}`,
    "",
    "## Diff Summary",
    "",
    `Changed files: ${input.changedFiles.length}`,
    `Diff hash: ${input.diffHash}`,
    "",
    ...input.changedFiles.map((file) => `- ${file}`),
    "",
    "## Evidence",
    "",
    ...result.report.evidence.map((item) => `- ${item}`),
    "",
    ...signalSection,
    "## Checks",
    "",
    ...(checks.length > 0 ? checks : ["- No checks recorded."]),
    "",
    "## Remaining Uncertainty",
    "",
    ...(result.report.uncertainty.length > 0
      ? result.report.uncertainty.map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
    "## Provenance",
    "",
    `- Working repository: ${result.materialization.repositoryUrl}`,
    `- Base branch: ${input.baseBranch}`,
    `- Base commit: ${result.materialization.resolvedCommit ?? "unknown"}`,
    `- Publish branch: ${input.branchName}`,
    "- Published from the prepared sandbox diff after approval.",
  ].join("\n");
}

async function readPublishableSignal(signalId: string): Promise<DocsSignalDetail> {
  const signal = await getDocsSignal({ id: signalId });
  if (signal.status !== "patch-prepared") {
    throw new GitHubWritebackError(
      `Cannot publish signal ${signal.id} because its status is ${signal.status}, not patch-prepared.`,
    );
  }
  return signal;
}

function buildDefaultPullRequestTitle(result: DocsMaintenanceWorkflowResult): string {
  return normalizePullRequestTitle(`Docs update: ${result.report.patchSummary}`);
}

function buildDefaultCommitMessage(result: DocsMaintenanceWorkflowResult): string {
  return normalizeCommitMessage(`docs: ${result.report.patchSummary}`);
}

function normalizeBranchName(branch: string): string {
  return branchNameSchema.parse(branch.replace(/^refs\/heads\//, ""));
}

function normalizePullRequestTitle(title: string): string {
  return truncateOneLine(title, 180);
}

function normalizeCommitMessage(message: string): string {
  return truncateOneLine(message, 240);
}

function assertRepositoryRelativePath(path: string): void {
  if (
    path.trim() === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").includes("..")
  ) {
    throw new GitHubWritebackError(`Use a repository-relative path: ${path}`);
  }
}

function joinSandboxPath(root: string, path: string): string {
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizeRepositoryUrl(value: string): string {
  return value.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

function recordPublishAction(
  repository: WorkingDocumentationRepository,
  status: RepositoryActionRecord["status"],
  details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
): RepositoryActionRecord {
  return {
    action: "publish-pr",
    provenanceLabel: repository.provenanceLabel,
    status,
    ...details,
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function slugifyBranchSegment(value: string): string {
  const slug = value
    .replace(/^refs\/heads\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[/.]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? "base" : slug.slice(0, 48);
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function encodeGitRefPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truncateOneLine(value: string, maxLength: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.slice(0, maxLength - 1).trimEnd();
}

function summarizeCommandFailure(result: { exitCode: number; stdout: string; stderr: string }): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  return truncateOneLine(stderr || stdout || `Command exited with ${result.exitCode}.`, 1_000);
}

function sh(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
