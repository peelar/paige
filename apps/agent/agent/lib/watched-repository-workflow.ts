import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  formatUnknownError,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  resolveGitHubAppInstallationToken,
} from "./github-app-client.js";
import { searchRepository } from "./repository-operations.js";
import {
  type WatchedRepository,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";
import {
  cloneRepositoryCheckout,
  quoteShellArgument as sh,
  recordRepositoryAction,
  repositoryActionRecordSchema,
  resolveRepositoryCommit,
  summarizeCommandFailure,
  type RepositoryActionRecord,
  type WatchedRepositoryCheckoutAccess,
  watchedRepositoryMaterializationPolicy,
} from "./repository-materialization.js";
import { impactDecisionSchema } from "./repository-workflow-contract.js";
import { requireSetupReady, resolveGitHubConnector } from "./setup-state.js";
import { loadOrMaterializeRepositoryWorkflowState } from "./working-repository-lifecycle.js";

const watchedRepositoryMaterializationSchema = z.object({
  repositoryId: z.string(),
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  resolvedCommit: z.string().optional(),
  sandboxPath: z.string(),
  status: z.enum(["materialized", "failed"]),
});

const watchedReleaseSignalSchema = z.object({
  repositoryId: z.string(),
  repositoryUrl: z.string(),
  releaseAccess: z.enum(["github-app", "public-github"]),
  releaseId: z.number(),
  name: z.string(),
  tagName: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  prerelease: z.boolean(),
  bodySummary: z.string(),
});

const watchedRepositoryFindingSchema = z.object({
  decision: impactDecisionSchema,
  watchedRepository: z.object({
    id: z.string(),
    name: z.string(),
    repositoryUrl: z.string(),
    importance: z.string(),
  }),
  signal: watchedReleaseSignalSchema,
  materialization: watchedRepositoryMaterializationSchema,
  searchTerms: z.array(z.string()),
  sourceEvidence: z.array(z.string()),
  docsEvidence: z.array(z.string()),
  consideredDocs: z.array(z.string()),
  proposedAction: z.string(),
  uncertainty: z.array(z.string()),
});

export const scanWatchedRepositoriesInputSchema = z.object({
  maxReleasesPerRepository: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe("Maximum recent releases to inspect per watched repository."),
});

export const scanWatchedRepositoriesResultSchema = z.object({
  ok: z.boolean(),
  scannedRepositories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      repositoryUrl: z.string(),
      releasesConsidered: z.number(),
    }),
  ),
  findings: z.array(watchedRepositoryFindingSchema),
  actionProvenance: z.array(repositoryActionRecordSchema),
  rawSandboxToolsPolicy: z.string(),
  noWatchedRepositories: z.boolean(),
});

export type ScanWatchedRepositoriesInput = z.infer<typeof scanWatchedRepositoriesInputSchema>;
export type ScanWatchedRepositoriesResult = z.infer<typeof scanWatchedRepositoriesResultSchema>;
type WatchedRepositoryMaterialization = z.infer<typeof watchedRepositoryMaterializationSchema>;
type WatchedReleaseSignal = z.infer<typeof watchedReleaseSignalSchema>;
type WatchedRepositoryFinding = z.infer<typeof watchedRepositoryFindingSchema>;

type GitHubRelease = {
  id: number;
  html_url: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
};

type GitHubReleaseAccess = WatchedRepositoryCheckoutAccess & { reason?: string };

type GitHubReleaseLookup = {
  access: GitHubReleaseAccess;
  releases: WatchedReleaseSignal[];
};

export async function scanWatchedRepositories(
  input: ScanWatchedRepositoriesInput,
  ctx: ToolContext,
): Promise<ScanWatchedRepositoriesResult> {
  const parsedInput = scanWatchedRepositoriesInputSchema.parse(input);
  const setup = await requireSetupReady("docs-maintenance");
  const watchedRepositories = setup.workingRepositoryInput.watchedRepositories;
  const actionProvenance: RepositoryActionRecord[] = [];

  if (watchedRepositories.length === 0) {
    return {
      ok: true,
      scannedRepositories: [],
      findings: [],
      actionProvenance,
      rawSandboxToolsPolicy:
        "Watched repository scans use authored workflow code and read-only repository actions; writeback remains limited to the working documentation repository.",
      noWatchedRepositories: true,
    };
  }

  const workingState = await loadOrMaterializeRepositoryWorkflowState(ctx);
  const workingRepository = workingState.repositoryInput.workingDocumentationRepository;
  const githubConnector = resolveGitHubConnector(setup);
  actionProvenance.push(...workingState.actionProvenance);

  const scannedRepositories: ScanWatchedRepositoriesResult["scannedRepositories"] = [];
  const findings: WatchedRepositoryFinding[] = [];

  for (const watchedRepository of watchedRepositories) {
    if (!watchedRepository.signals.includes("releases")) {
      actionProvenance.push(
        recordWatchedAction(watchedRepository, "scan-releases", "success", {
          reason: "Repository is not configured for release signals.",
        }),
      );
      scannedRepositories.push({
        id: watchedRepository.id,
        name: watchedRepository.name,
        repositoryUrl: watchedRepository.source.url,
        releasesConsidered: 0,
      });
      continue;
    }

    const releaseLookup = await fetchRecentReleases(
      watchedRepository,
      parsedInput.maxReleasesPerRepository,
      ctx,
      actionProvenance,
      githubConnector,
    );
    scannedRepositories.push({
      id: watchedRepository.id,
      name: watchedRepository.name,
      repositoryUrl: watchedRepository.source.url,
      releasesConsidered: releaseLookup.releases.length,
    });

    for (const signal of releaseLookup.releases) {
      const materialization = await materializeWatchedRepository(
        ctx,
        watchedRepository,
        signal.tagName || watchedRepository.defaultRef,
        actionProvenance,
        releaseLookup.access,
      );
      const searchTerms = extractSearchTerms(signal);
      const sourceEvidence = await collectWatchedSourceEvidence(
        ctx,
        watchedRepository,
        searchTerms,
        actionProvenance,
      );
      const docsEvidence = await collectWorkingDocsEvidence(
        ctx,
        workingRepository,
        searchTerms,
        actionProvenance,
      );

      findings.push(
        buildFinding({
          watchedRepository,
          signal,
          materialization,
          searchTerms,
          sourceEvidence,
          docsEvidence,
        }),
      );
    }
  }

  return {
    ok: findings.every((finding) => finding.materialization.status === "materialized"),
    scannedRepositories,
    findings,
    actionProvenance,
    rawSandboxToolsPolicy:
      "Watched repository scans use authored workflow code and read-only repository actions; writeback remains limited to the working documentation repository.",
    noWatchedRepositories: false,
  };
}

async function fetchRecentReleases(
  repository: WatchedRepository,
  limit: number,
  ctx: ToolContext,
  actionProvenance: RepositoryActionRecord[],
  githubConnector: string,
): Promise<GitHubReleaseLookup> {
  const slug = parseGitHubRepositoryUrl(repository.source.url);
  const access = await resolveGitHubReleaseAccess({
    repository,
    slug,
    connector: githubConnector,
    actionProvenance,
  });
  const result = await githubApiRequest<GitHubRelease[]>({
    token: access.mode === "github-app" ? access.token : undefined,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(
      slug.repo,
    )}/releases?per_page=${limit}`,
    abortSignal: ctx.abortSignal,
  });

  if (!result.ok) {
    const reason =
      access.mode === "public-github"
        ? `GitHub release signal lookup failed through public GitHub API access: ${result.message}`
        : `GitHub release signal lookup failed through GitHub App access: ${result.message}`;
    actionProvenance.push(
      recordWatchedAction(repository, "scan-releases", "failure", { reason }),
    );
    throw new Error(reason);
  }

  actionProvenance.push(
    recordWatchedAction(repository, "scan-releases", "success", {
      target: `${slug.owner}/${slug.repo}`,
      reason:
        access.mode === "public-github"
          ? access.reason ?? "Used public GitHub API access for release signals."
          : "Used GitHub App access for release signals.",
    }),
  );

  const releases = result.body
    .filter((release) => !release.draft)
    .slice(0, limit)
    .map((release) => ({
      repositoryId: repository.id,
      repositoryUrl: repository.source.url,
      releaseAccess: access.mode,
      releaseId: release.id,
      name: release.name?.trim() || release.tag_name,
      tagName: release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
      prerelease: release.prerelease,
      bodySummary: summarizeReleaseBody(release.body ?? ""),
    }));

  return { access, releases };
}

async function resolveGitHubReleaseAccess(input: {
  repository: WatchedRepository;
  slug: ReturnType<typeof parseGitHubRepositoryUrl>;
  connector: string;
  actionProvenance: RepositoryActionRecord[];
}): Promise<GitHubReleaseAccess> {
  const connector = input.connector.trim();
  const target = `${input.slug.owner}/${input.slug.repo}`;

  if (connector === "") {
    const reason =
      "No GitHub connector is configured; using public GitHub API access for watched release signals.";
    input.actionProvenance.push(
      recordWatchedAction(input.repository, "select-github-access", "success", {
        target,
        reason,
      }),
    );
    return { mode: "public-github", reason };
  }

  try {
    const tokenResponse = await resolveGitHubAppInstallationToken({
      connector,
      slug: input.slug,
    });
    input.actionProvenance.push(
      recordWatchedAction(input.repository, "resolve-github-token", "success", {
        target: connector,
      }),
    );
    return { mode: "github-app", token: tokenResponse.token };
  } catch (error) {
    const reason =
      `GitHub App access from Vercel Connect connector ${connector} is not available for ${target}; using public GitHub API access for watched release signals. ${formatGitHubAccessError(error)}`;
    input.actionProvenance.push(
      recordWatchedAction(input.repository, "select-github-access", "success", {
        target,
        reason,
      }),
    );
    return { mode: "public-github", reason };
  }
}

async function materializeWatchedRepository(
  ctx: ToolContext,
  repository: WatchedRepository,
  ref: string,
  actionProvenance: RepositoryActionRecord[],
  access: GitHubReleaseAccess,
): Promise<WatchedRepositoryMaterialization> {
  const policy = watchedRepositoryMaterializationPolicy(repository, ref, access);
  await cloneRepositoryCheckout(ctx, policy, actionProvenance);
  const resolvedCommit = await resolveRepositoryCommit(ctx, repository.sandboxPath);

  return {
    repositoryId: repository.id,
    repositoryUrl: repository.source.url,
    requestedRef: ref,
    resolvedCommit,
    sandboxPath: repository.sandboxPath,
    status: "materialized",
  };
}

async function collectWatchedSourceEvidence(
  ctx: ToolContext,
  repository: WatchedRepository,
  searchTerms: string[],
  actionProvenance: RepositoryActionRecord[],
): Promise<string[]> {
  const evidence: string[] = [];

  for (const term of searchTerms.slice(0, 5)) {
    const matches = await searchWatchedRepository(ctx, repository, term, actionProvenance);
    if (matches.trim() !== "") {
      evidence.push(`Source search for "${term}" found:\n${matches}`);
    }
  }

  return evidence.slice(0, 5);
}

async function collectWorkingDocsEvidence(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository & { docsRoot: string },
  searchTerms: string[],
  actionProvenance: RepositoryActionRecord[],
): Promise<string[]> {
  const evidence: string[] = [];

  for (const term of searchTerms.slice(0, 5)) {
    const matches = await searchRepository(ctx, repository, escapeRegExp(term), actionProvenance);
    if (matches.trim() !== "") {
      evidence.push(`Docs search for "${term}" found:\n${matches}`);
    }
  }

  return evidence.slice(0, 5);
}

async function searchWatchedRepository(
  ctx: ToolContext,
  repository: WatchedRepository,
  query: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertWatchedActionAllowed(repository, "search");
  const sandbox = await ctx.getSandbox();
  const globArgs = repository.pathFilters.flatMap((filter) => ["--glob", sh(filter)]);
  const command = [
    "rg",
    "-F",
    "-n",
    "--max-count",
    "5",
    ...globArgs,
    sh(query),
    ".",
  ].join(" ");
  const result = await sandbox.run({
    command,
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode > 1) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(
      recordWatchedAction(repository, "search", "failure", { target: query, reason }),
    );
    throw new Error(`Watched repository search failed for ${repository.id}: ${reason}`);
  }

  actionProvenance.push(
    recordWatchedAction(repository, "search", "success", { target: query }),
  );
  return truncate(result.stdout, 4_000);
}

function buildFinding(input: {
  watchedRepository: WatchedRepository;
  signal: WatchedReleaseSignal;
  materialization: WatchedRepositoryMaterialization;
  searchTerms: string[];
  sourceEvidence: string[];
  docsEvidence: string[];
}): WatchedRepositoryFinding {
  const releaseText = `${input.signal.name}\n${input.signal.bodySummary}`.toLowerCase();
  const hasDocsImpactLanguage = [
    "api",
    "graphql",
    "breaking",
    "deprecated",
    "permission",
    "webhook",
    "configuration",
    "behavior",
    "customer",
    "public",
  ].some((keyword) => releaseText.includes(keyword));

  let decision: z.infer<typeof impactDecisionSchema>;
  let proposedAction: string;
  const uncertainty: string[] = [];

  if (input.sourceEvidence.length === 0) {
    decision = "ask-maintainer";
    proposedAction =
      "Ask a maintainer to confirm whether this release has customer-facing docs impact before preparing a docs patch.";
    uncertainty.push(
      "The release signal could not be verified against matching watched-repository code evidence.",
    );
  } else if (input.docsEvidence.length > 0) {
    decision = "no-docs-change";
    proposedAction =
      "Do not prepare a patch from this scan alone; current docs already mention the release terms that were verified in source.";
    uncertainty.push(
      "A term match is not a semantic proof that the docs are complete; review may still be needed for major releases.",
    );
  } else if (hasDocsImpactLanguage) {
    decision = "docs-patch";
    proposedAction =
      "Prepare a working-documentation-repository patch in a separate approved docs-maintenance flow; do not write to the watched repository.";
  } else {
    decision = "ask-maintainer";
    proposedAction =
      "Ask a maintainer whether this release should be documented, because the scan found source evidence but no clear docs-impact language.";
    uncertainty.push(
      "The release wording did not clearly indicate a public documentation change.",
    );
  }

  return {
    decision,
    watchedRepository: {
      id: input.watchedRepository.id,
      name: input.watchedRepository.name,
      repositoryUrl: input.watchedRepository.source.url,
      importance: input.watchedRepository.importance,
    },
    signal: input.signal,
    materialization: input.materialization,
    searchTerms: input.searchTerms,
    sourceEvidence: input.sourceEvidence,
    docsEvidence: input.docsEvidence,
    consideredDocs: input.docsEvidence.length > 0
      ? extractPathsFromSearchEvidence(input.docsEvidence)
      : ["No matching working-documentation-repository pages found by term search."],
    proposedAction,
    uncertainty,
  };
}

function extractSearchTerms(signal: WatchedReleaseSignal): string[] {
  const text = `${signal.name}\n${signal.bodySummary}`;
  const terms = new Set<string>();

  for (const match of text.matchAll(/`([^`\n]{3,80})`/g)) {
    terms.add(match[1].trim());
  }

  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/g)) {
    terms.add(match[0]);
  }

  for (const word of text.split(/[^A-Za-z0-9_-]+/)) {
    const normalized = word.trim();
    if (normalized.length < 5 || normalized.length > 48) continue;
    if (COMMON_RELEASE_WORDS.has(normalized.toLowerCase())) continue;
    terms.add(normalized);
  }

  return Array.from(terms).slice(0, 6);
}

function extractPathsFromSearchEvidence(evidence: string[]): string[] {
  const paths = new Set<string>();

  for (const item of evidence) {
    for (const line of item.split("\n")) {
      const [path] = line.split(":");
      if (path?.startsWith("/workspace/working-docs/")) {
        paths.add(path.replace(/^\/workspace\/working-docs\//, ""));
      }
    }
  }

  return paths.size > 0 ? Array.from(paths).slice(0, 10) : ["Working docs contained matching terms."];
}

function summarizeReleaseBody(body: string): string {
  return truncate(body.replace(/\s+/g, " ").trim(), 1_000);
}

function formatGitHubAccessError(error: unknown): string {
  const base = formatUnknownError(error);
  if (!isRecord(error)) return base;

  const vendor = error.vendor;
  if (!isRecord(vendor) || typeof vendor.message !== "string") return base;

  return `${base} Vendor message: ${vendor.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertWatchedActionAllowed(
  repository: WatchedRepository,
  action: WatchedRepository["allowedActions"][number],
): void {
  if (!repository.allowedActions.includes(action)) {
    throw new Error(`Watched repository action is not allowed: ${action}`);
  }
}

function recordWatchedAction(
  repository: WatchedRepository,
  action: string,
  status: RepositoryActionRecord["status"],
  details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
): RepositoryActionRecord {
  return recordRepositoryAction(repository, action, status, details);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMMON_RELEASE_WORDS = new Set([
  "about",
  "added",
  "change",
  "changes",
  "fixed",
  "github",
  "improve",
  "improved",
  "release",
  "released",
  "support",
  "updated",
  "version",
]);
