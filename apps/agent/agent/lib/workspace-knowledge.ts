import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  buildWorkspaceKnowledgeSourceRegistry,
  projectWorkspaceKnowledgeSource,
  workspaceKnowledgeEvidenceClassSchema,
  workspaceKnowledgeSourceReferenceSchema,
  type RepositoryInput,
  type WorkspaceKnowledgeSource,
} from "./repository-contract";
import { parseGitHubRepositoryUrl, resolveGitHubAppInstallationToken } from "./github-app-client";
import {
  cloneRepositoryCheckout,
  readOnlyRepositoryMaterializationPolicy,
  recordRepositoryAction,
  resolveRepositoryCommit,
  type RepositoryActionRecord,
  type ReadOnlyRepository,
  type ReadOnlyRepositoryCheckoutAccess,
} from "./repository-materialization";
import { saveRepositoryWorkflowState } from "./repository-workflow-state";
import { DEFAULT_WORKSPACE_ID, requireSetupReady, resolveGitHubConnector } from "./setup-state";
import {
  loadOrMaterializeRepositoryWorkflowState,
  runWorkingRepositoryOperationSerially,
  workingRepositoryOperationKey,
} from "./working-repository-lifecycle";
import {
  assertSafeRepositoryRelativePath,
  truncateText,
  WorkingRepositoryService,
  type RepositoryInspectionTarget,
} from "./working-repository-service";

const searchMatchSchema = z.object({
  sourceId: z.string(),
  provenanceLabel: z.string(),
  evidenceClass: workspaceKnowledgeEvidenceClassSchema,
  repositoryUrl: z.string().url(),
  requestedRef: z.string(),
  resolvedRevision: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
  excerpt: z.string().max(500),
  contentTrust: z.literal("untrusted-data"),
  redacted: z.boolean(),
});

export const workspaceKnowledgeSearchResultSchema = z.object({
  sourceIds: z.array(z.string()),
  matches: z.array(searchMatchSchema).max(100),
  failures: z.array(z.object({
    sourceId: z.string(),
    status: z.literal("failed"),
    reason: z.enum(["missing-auth", "stale-ref", "rate-limited", "unavailable"]),
    retryable: z.boolean(),
    error: z.string().max(2_000),
  })),
  truncated: z.boolean(),
});

export const workspaceKnowledgeReadResultSchema = z.object({
  sourceId: z.string(),
  provenanceLabel: z.string(),
  evidenceClass: workspaceKnowledgeEvidenceClassSchema,
  repositoryUrl: z.string().url(),
  requestedRef: z.string(),
  resolvedRevision: z.string(),
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string().nullable(),
  binary: z.boolean(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  contentTrust: z.literal("untrusted-data"),
  redacted: z.boolean(),
});

export const workspaceKnowledgeListResultSchema = z.object({
  sources: z.array(workspaceKnowledgeSourceReferenceSchema).max(50),
});

export type WorkspaceKnowledgeSearchResult = z.infer<
  typeof workspaceKnowledgeSearchResultSchema
>;
export type WorkspaceKnowledgeReadResult = z.infer<typeof workspaceKnowledgeReadResultSchema>;

type SourceRuntime = {
  service: WorkingRepositoryService;
  resolvedRevision: string;
  finish: () => Promise<void>;
};

export type WorkspaceKnowledgeDependencies = {
  resolveGitHubToken(input: { connector: string; repositoryUrl: string }): Promise<string>;
};

const defaultDependencies: WorkspaceKnowledgeDependencies = {
  async resolveGitHubToken({ connector, repositoryUrl }) {
    const response = await resolveGitHubAppInstallationToken({
      connector,
      slug: parseGitHubRepositoryUrl(repositoryUrl),
    });
    return response.token;
  },
};

export async function listWorkspaceKnowledgeSources() {
  const { workingRepositoryInput } = await requireSetupReady("docs-maintenance");
  return workspaceKnowledgeListResultSchema.parse({
    sources: buildRegistry(workingRepositoryInput).map(projectWorkspaceKnowledgeSource),
  });
}

export async function searchWorkspaceKnowledge(input: {
  sourceIds?: string[];
  query: string;
  kind?: "literal" | "regex";
  caseSensitive?: boolean;
  limit?: number;
}, ctx: ToolContext, dependencies: WorkspaceKnowledgeDependencies = defaultDependencies): Promise<WorkspaceKnowledgeSearchResult> {
  const setup = await requireSetupReady("docs-maintenance");
  const registry = buildRegistry(setup.workingRepositoryInput);
  const sources = selectSources(registry, input.sourceIds);
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const sourceLimit = Math.max(1, Math.floor(limit / sources.length));
  const matches: WorkspaceKnowledgeSearchResult["matches"] = [];
  const failures: WorkspaceKnowledgeSearchResult["failures"] = [];
  let truncated = false;

  for (const source of sources) {
    try {
      await useSourceRuntime(source, setup.workingRepositoryInput, ctx, dependencies, async (runtime) => {
        const filters = normalizedSearchFilters(source);
        const sourceStart = matches.length;
        for (const pattern of filters) {
          const sourceRemaining = sourceLimit - (matches.length - sourceStart);
          if (matches.length >= limit || sourceRemaining <= 0) {
            truncated = true;
            break;
          }
          const result = await runtime.service.search({
            query: input.query,
            kind: input.kind,
            caseSensitive: input.caseSensitive,
            pattern,
            limit: Math.min(sourceRemaining, source.modelOutput.maxSearchMatches),
          });
          truncated ||= result.truncated;
          for (const match of result.matches) {
            const redaction = redactSensitiveText(match.excerpt);
            const bounded = truncateText(redaction.text, source.modelOutput.maxExcerptCharacters);
            matches.push(searchMatchSchema.parse({
              sourceId: source.sourceId,
              provenanceLabel: source.provenanceLabel,
              evidenceClass: source.evidenceClass,
              repositoryUrl: source.repository?.url,
              requestedRef: source.repository?.requestedRef,
              resolvedRevision: runtime.resolvedRevision,
              path: match.path,
              line: match.line,
              excerpt: bounded.content,
              contentTrust: "untrusted-data",
              redacted: redaction.redacted,
            }));
            if (matches.length >= limit) {
              truncated = true;
              break;
            }
          }
        }
      });
    } catch (error) {
      failures.push(workspaceKnowledgeSourceFailure(source.sourceId, error));
    }
  }

  return workspaceKnowledgeSearchResultSchema.parse({
    sourceIds: sources.map(({ sourceId }) => sourceId),
    matches,
    failures,
    truncated,
  });
}

export async function readWorkspaceKnowledge(input: {
  sourceId: string;
  path: string;
  startLine?: number;
  endLine?: number;
  maxCharacters?: number;
}, ctx: ToolContext, dependencies: WorkspaceKnowledgeDependencies = defaultDependencies): Promise<WorkspaceKnowledgeReadResult> {
  const setup = await requireSetupReady("docs-maintenance");
  const source = selectSources(buildRegistry(setup.workingRepositoryInput), [input.sourceId])[0];
  if (source === undefined) throw new Error(`Unknown workspace knowledge source: ${input.sourceId}`);
  const path = assertSafeRepositoryRelativePath(input.path);
  assertPathAllowed(source, path);
  return useSourceRuntime(source, setup.workingRepositoryInput, ctx, dependencies, async (runtime) => {
    const read = await runtime.service.read({
      path,
      startLine: input.startLine,
      endLine: input.endLine,
      maxCharacters: Math.min(
        input.maxCharacters ?? source.modelOutput.maxReadCharacters,
        source.modelOutput.maxReadCharacters,
      ),
    });
    const redaction = read.content === null
      ? { text: null, redacted: false }
      : redactSensitiveText(read.content);
    return workspaceKnowledgeReadResultSchema.parse({
      sourceId: source.sourceId,
      provenanceLabel: source.provenanceLabel,
      evidenceClass: source.evidenceClass,
      repositoryUrl: source.repository?.url,
      requestedRef: source.repository?.requestedRef,
      resolvedRevision: runtime.resolvedRevision,
      ...read,
      content: redaction.text,
      contentTrust: "untrusted-data",
      redacted: redaction.redacted,
    });
  });
}

export function redactSensitiveText(value: string): { text: string; redacted: boolean } {
  let text = value;
  text = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
    "[REDACTED PRIVATE KEY]",
  );
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, "[REDACTED TOKEN]");
  text = text.replace(
    /\b(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"']{8,}["']?/giu,
    "$1=[REDACTED]",
  );
  return { text, redacted: text !== value };
}

function buildRegistry(repositoryInput: RepositoryInput): WorkspaceKnowledgeSource[] {
  return buildWorkspaceKnowledgeSourceRegistry({
    workspaceId: DEFAULT_WORKSPACE_ID,
    repositoryInput,
  });
}

function selectSources(
  registry: WorkspaceKnowledgeSource[],
  requested?: string[],
): WorkspaceKnowledgeSource[] {
  if (requested === undefined || requested.length === 0) return registry;
  const ids = z.array(z.string().trim().min(1).max(160)).min(1).max(10).parse(requested);
  const byId = new Map(registry.map((source) => [source.sourceId, source]));
  return ids.map((sourceId) => {
    const source = byId.get(sourceId);
    if (source === undefined) throw new Error(`Unknown workspace knowledge source: ${sourceId}`);
    return source;
  });
}

async function openSourceRuntime(
  source: WorkspaceKnowledgeSource,
  repositoryInput: RepositoryInput,
  ctx: ToolContext,
  dependencies: WorkspaceKnowledgeDependencies,
): Promise<SourceRuntime> {
  if (source.kind === "working-documentation") {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    const service = new WorkingRepositoryService({
      ctx,
      repository: state.repositoryInput.workingDocumentationRepository,
      materialization: state.materialization,
      actionProvenance: state.actionProvenance,
    });
    return {
      service,
      resolvedRevision: service.reference.resolvedRevision,
      finish: async () => await saveRepositoryWorkflowState(state),
    };
  }
  if (source.kind !== "watched-repository" && source.kind !== "context-repository") {
    throw new Error(`Workspace knowledge source kind is not repository-readable: ${source.kind}`);
  }

  const repository = findReadOnlyRepository(repositoryInput, source);
  const actions: RepositoryActionRecord[] = [];
  const access = await resolveReadOnlyRepositoryAccess(repository, source, actions, dependencies);
  await cloneRepositoryCheckout(ctx, readOnlyRepositoryMaterializationPolicy({
    sourceKind: source.kind,
    repository,
    requestedRef: source.repository?.requestedRef ?? readOnlyRequestedRef(repository),
    access,
  }), actions);
  const resolvedRevision = await resolveRepositoryCommit(ctx, repository.sandboxPath);
  if (resolvedRevision === undefined) {
    throw new Error(`Resolved revision is unavailable for source ${source.sourceId}.`);
  }
  const target: RepositoryInspectionTarget = {
    source: repository.source,
    ref: source.repository?.requestedRef ?? readOnlyRequestedRef(repository),
    docsRoot: ".",
    sandboxPath: repository.sandboxPath,
    allowedActions: repository.allowedActions,
    provenanceLabel: repository.provenanceLabel,
  };
  const service = new WorkingRepositoryService({
    ctx,
    repository: target,
    materialization: {
      repositoryUrl: repository.source.url,
      requestedRef: target.ref,
      resolvedCommit: resolvedRevision,
      docsRoot: ".",
      sandboxPath: repository.sandboxPath,
      status: "materialized",
    },
    actionProvenance: actions,
  });
  return { service, resolvedRevision, finish: async () => undefined };
}

async function useSourceRuntime<T>(
  source: WorkspaceKnowledgeSource,
  repositoryInput: RepositoryInput,
  ctx: ToolContext,
  dependencies: WorkspaceKnowledgeDependencies,
  operation: (runtime: SourceRuntime) => Promise<T>,
): Promise<T> {
  const use = async () => {
    const runtime = await openSourceRuntime(source, repositoryInput, ctx, dependencies);
    try {
      return await operation(runtime);
    } finally {
      await runtime.finish();
    }
  };
  if (source.kind !== "working-documentation") return use();
  const repository = repositoryInput.workingDocumentationRepository;
  return runWorkingRepositoryOperationSerially(
    workingRepositoryOperationKey(ctx.session.id, repository),
    use,
  );
}

function findReadOnlyRepository(
  input: RepositoryInput,
  source: WorkspaceKnowledgeSource,
): ReadOnlyRepository {
  const id = source.sourceId.replace(/^(watched|context):/u, "");
  const candidates: ReadOnlyRepository[] = source.kind === "watched-repository"
    ? input.watchedRepositories
    : input.contextRepositories;
  const repository = candidates.find((candidate) => candidate.id === id);
  if (repository === undefined) throw new Error(`Configured source is unavailable: ${source.sourceId}`);
  return repository;
}

async function resolveReadOnlyRepositoryAccess(
  repository: ReadOnlyRepository,
  source: WorkspaceKnowledgeSource,
  actions: RepositoryActionRecord[],
  dependencies: WorkspaceKnowledgeDependencies,
): Promise<ReadOnlyRepositoryCheckoutAccess> {
  const ready = await requireSetupReady("docs-maintenance");
  const connector = resolveGitHubConnector(ready);
  if (connector === "") {
    actions.push(recordRepositoryAction(repository, "select-github-access", "success", {
      target: source.sourceId,
      reason: "No GitHub connector is configured; public GitHub access will be attempted.",
    }));
    return { mode: "public-github" };
  }
  try {
    const token = await dependencies.resolveGitHubToken({
      connector,
      repositoryUrl: repository.source.url,
    });
    return { mode: "github-app", token };
  } catch (error) {
    const failure = workspaceKnowledgeSourceFailure(source.sourceId, error);
    actions.push(recordRepositoryAction(repository, "select-github-access", "failure", {
      target: source.sourceId,
      reason: `Configured GitHub App access failed (${failure.reason}): ${failure.error}`,
    }));
    throw new WorkspaceKnowledgeSourceAccessError(failure);
  }
}

function readOnlyRequestedRef(repository: ReadOnlyRepository): string {
  return "defaultRef" in repository ? repository.defaultRef : repository.ref;
}

function normalizedSearchFilters(source: WorkspaceKnowledgeSource): string[] {
  const filters = source.repository?.pathFilters ?? [];
  if (filters.length === 0) return ["**/*"];
  return [...new Set(filters.flatMap((filter) => {
    if (filter === ".") return ["**/*"];
    if (/[*?]/u.test(filter)) return [filter];
    const path = filter.replace(/\/+$/u, "");
    return [path, `${path}/**/*`];
  }))];
}

function assertPathAllowed(source: WorkspaceKnowledgeSource, path: string): void {
  const filters = source.repository?.pathFilters ?? [];
  if (filters.length === 0 || filters.some((filter) => pathMatchesFilter(path, filter))) return;
  throw new Error(`Path is outside the configured filters for source ${source.sourceId}: ${path}`);
}

function pathMatchesFilter(path: string, filter: string): boolean {
  if (filter === ".") return true;
  if (!/[*?]/u.test(filter)) return path === filter || path.startsWith(`${filter.replace(/\/+$/u, "")}/`);
  let expression = "^";
  for (let index = 0; index < filter.length; index += 1) {
    const character = filter[index];
    if (character === "*" && filter[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character?.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") ?? "";
  }
  return new RegExp(`${expression}$`, "u").test(path);
}

function boundedError(error: unknown): string {
  const bounded = truncateText(error instanceof Error ? error.message : String(error), 2_000);
  return redactSensitiveText(bounded.content).text;
}

export type WorkspaceKnowledgeSourceFailureReason =
  | "missing-auth"
  | "stale-ref"
  | "rate-limited"
  | "unavailable";

export function classifyWorkspaceKnowledgeSourceFailure(
  error: unknown,
): WorkspaceKnowledgeSourceFailureReason {
  if (error instanceof WorkspaceKnowledgeSourceAccessError) return error.reason;
  const message = boundedError(error).toLowerCase();
  if (/rate.?limit|secondary rate|\b429\b/u.test(message)) return "rate-limited";
  if (
    /remote (?:branch|ref)|couldn['’]?t find remote ref|pathspec|reference is not a tree|unknown revision|stale ref|missing ref/u
      .test(message)
  ) return "stale-ref";
  if (
    /authentication|authorization|not authorized|access denied|permission denied|not granted|app installation|\b401\b|\b403\b/u
      .test(message)
  ) return "missing-auth";
  return "unavailable";
}

function workspaceKnowledgeSourceFailure(
  sourceId: string,
  error: unknown,
): WorkspaceKnowledgeSearchResult["failures"][number] {
  const reason = classifyWorkspaceKnowledgeSourceFailure(error);
  return {
    sourceId,
    status: "failed",
    reason,
    retryable: reason === "rate-limited" || reason === "unavailable",
    error: boundedError(error),
  };
}

class WorkspaceKnowledgeSourceAccessError extends Error {
  readonly reason: WorkspaceKnowledgeSourceFailureReason;

  constructor(failure: WorkspaceKnowledgeSearchResult["failures"][number]) {
    super(`[${failure.reason}] ${failure.error}`);
    this.name = "WorkspaceKnowledgeSourceAccessError";
    this.reason = failure.reason;
  }
}
