import { z } from "zod";

import { parseGitHubRepositoryUrl } from "./github-app-client.ts";
import {
  runGitHubWritebackPreflight,
  type GitHubWritebackPreflight,
} from "./github-preflight.ts";
import {
  DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF,
  repositoryInputSchema,
  type RepositoryInput,
} from "./repository-contract.ts";
import { validateWorkingRepositoryAccess } from "./repository-validation.ts";
import {
  readSetupState,
  saveSetupState,
  SETUP_STATE_VERSION,
  setupStateSchema,
  type SetupAuditActor,
  type SetupState,
} from "./setup-state.ts";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

export const workspaceOnboardingWatchedRepositorySchema = z.object({
  repositoryUrl: z.string().trim().min(1),
  name: optionalText,
  description: optionalText,
  importance: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  defaultRef: z.string().trim().min(1).default(DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF),
  pathFilters: z.array(z.string().trim().min(1)).default([]),
  signals: z.array(z.enum(["releases", "pull-requests", "issues"]))
    .nonempty()
    .default(["releases"]),
});

export const workspaceOnboardingContextRepositorySchema = z.object({
  repositoryUrl: z.string().trim().min(1),
  name: optionalText,
  description: optionalText,
  ref: z.string().trim().min(1).default(DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF),
  pathFilters: z.array(z.string().trim().min(1)).default([]),
  evidenceClass: z.enum([
    "source-code-or-merged-change",
    "maintainer-confirmed-product-decision",
  ]).default("source-code-or-merged-change"),
  canSupportPublicDocsClaim: z.boolean().default(true),
});

export const workspaceOnboardingInputSchema = z.object({
  repositoryUrl: z.string().trim().min(1),
  ref: z.string().trim().min(1).default(DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF),
  docsRoot: optionalText,
  githubConnector: optionalText,
  watchedRepositories: z.array(workspaceOnboardingWatchedRepositorySchema).default([]),
  contextRepositories: z.array(workspaceOnboardingContextRepositorySchema).default([]),
});

export const workspaceOnboardingCheckSchema = z.object({
  id: z.enum(["repository", "github-writeback", "watched-repositories", "context-repositories"]),
  status: z.enum(["passed", "blocked"]),
  message: z.string(),
});

export const workspaceOnboardingValidationSchema = z.object({
  readyForPersistence: z.boolean(),
  input: workspaceOnboardingInputSchema.optional(),
  checks: z.array(workspaceOnboardingCheckSchema),
});

export const workspaceOnboardingDraftSchema = workspaceOnboardingInputSchema.extend({
  repositoryUrl: z.string(),
});

export type WorkspaceOnboardingInput = z.infer<typeof workspaceOnboardingInputSchema>;
export type WorkspaceOnboardingValidation = z.infer<
  typeof workspaceOnboardingValidationSchema
>;
export type WorkspaceOnboardingDraft = z.infer<typeof workspaceOnboardingDraftSchema>;

type WorkspaceOnboardingDependencies = {
  validateRepository: typeof validateWorkingRepositoryAccess;
  preflight: typeof runGitHubWritebackPreflight;
};

const defaultDependencies: WorkspaceOnboardingDependencies = {
  validateRepository: validateWorkingRepositoryAccess,
  preflight: runGitHubWritebackPreflight,
};

export async function readWorkspaceOnboardingDraft(): Promise<WorkspaceOnboardingDraft> {
  const state = await readSetupState();
  const repositoryInput = state?.workingRepositoryInput;
  const working = repositoryInput?.workingDocumentationRepository;
  return workspaceOnboardingDraftSchema.parse({
    repositoryUrl: working?.source.url ?? "",
    ref: working?.ref ?? DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF,
    docsRoot: working?.docsRoot,
    githubConnector: state?.githubWriteback.connector,
    watchedRepositories: (repositoryInput?.watchedRepositories ?? []).map((repository) => ({
      repositoryUrl: repository.source.url,
      name: repository.name,
      description: repository.description,
      importance: repository.importance,
      defaultRef: repository.defaultRef,
      pathFilters: repository.pathFilters,
      signals: repository.signals,
    })),
    contextRepositories: (repositoryInput?.contextRepositories ?? []).map((repository) => ({
      repositoryUrl: repository.source.url,
      name: repository.name,
      description: repository.description,
      ref: repository.ref,
      pathFilters: repository.pathFilters,
      evidenceClass: repository.evidenceClass,
      canSupportPublicDocsClaim: repository.canSupportPublicDocsClaim,
    })),
  });
}

export async function validateWorkspaceOnboarding(
  input: unknown,
  dependencies: WorkspaceOnboardingDependencies = defaultDependencies,
  abortSignal?: AbortSignal,
): Promise<WorkspaceOnboardingValidation> {
  const parsed = workspaceOnboardingInputSchema.safeParse(input);
  if (!parsed.success) {
    return workspaceOnboardingValidationSchema.parse({
      readyForPersistence: false,
      checks: [{
        id: "repository",
        status: "blocked",
        message: parsed.error.issues[0]?.message ?? "Workspace setup is invalid.",
      }],
    });
  }

  let state: SetupState;
  try {
    state = buildWorkspaceOnboardingState(parsed.data);
  } catch (error) {
    return workspaceOnboardingValidationSchema.parse({
      readyForPersistence: false,
      input: parsed.data,
      checks: [{
        id: "repository",
        status: "blocked",
        message: error instanceof Error ? error.message : String(error),
      }],
    });
  }

  const [repositoryResult, preflightResult] = await Promise.allSettled([
    dependencies.validateRepository({
      repositoryInput: state.workingRepositoryInput as RepositoryInput,
      setupState: state,
      abortSignal,
    }),
    dependencies.preflight({ state, abortSignal }),
  ]);
  const preflight = preflightResult.status === "fulfilled"
    ? preflightResult.value
    : {
        status: "connector-unavailable" as const,
        message: preflightResult.reason instanceof Error
          ? preflightResult.reason.message
          : String(preflightResult.reason),
      };
  const checks = [
    {
      id: "repository" as const,
      status: repositoryResult.status === "fulfilled" ? "passed" as const : "blocked" as const,
      message: repositoryResult.status === "fulfilled"
        ? parsed.data.docsRoot === undefined
          ? `Repository and ref ${parsed.data.ref} are accessible. Docs root remains unset for checkout-time inference.`
          : `Repository, ref ${parsed.data.ref}, and docs root ${parsed.data.docsRoot} are accessible.`
        : repositoryResult.reason instanceof Error
          ? repositoryResult.reason.message
          : String(repositoryResult.reason),
    },
    preflightCheck(preflight),
    {
      id: "watched-repositories" as const,
      status: "passed" as const,
      message: parsed.data.watchedRepositories.length === 0
        ? "No watched repositories will be configured."
        : `${parsed.data.watchedRepositories.length} watched repositories retain sandbox-read access and read-only actions.`,
    },
    {
      id: "context-repositories" as const,
      status: "passed" as const,
      message: parsed.data.contextRepositories.length === 0
        ? "No context repositories will be configured."
        : `${parsed.data.contextRepositories.length} context repositories retain sandbox-read access and read-only actions.`,
    },
  ];

  return workspaceOnboardingValidationSchema.parse({
    readyForPersistence: checks.every((check) => check.status === "passed"),
    input: parsed.data,
    checks,
  });
}

export async function saveValidatedWorkspaceOnboarding(input: {
  setup: unknown;
  actor: SetupAuditActor;
  abortSignal?: AbortSignal;
}, dependencies: WorkspaceOnboardingDependencies = defaultDependencies): Promise<{
  state: SetupState;
  validation: WorkspaceOnboardingValidation;
}> {
  const validation = await validateWorkspaceOnboarding(
    input.setup,
    dependencies,
    input.abortSignal,
  );
  if (!validation.readyForPersistence || validation.input === undefined) {
    throw new WorkspaceOnboardingValidationError(validation);
  }
  const state = buildWorkspaceOnboardingState(validation.input);
  await saveSetupState(state, {
    actor: input.actor,
    action: "workspace-onboarding-saved",
  });
  return { state, validation };
}

export class WorkspaceOnboardingValidationError extends Error {
  readonly validation: WorkspaceOnboardingValidation;

  constructor(validation: WorkspaceOnboardingValidation) {
    super("Workspace setup did not pass validation and was not persisted.");
    this.name = "WorkspaceOnboardingValidationError";
    this.validation = validation;
  }
}

export function buildWorkspaceOnboardingState(
  input: WorkspaceOnboardingInput,
): SetupState {
  const parsed = workspaceOnboardingInputSchema.parse(input);
  const watchedRepositories = parsed.watchedRepositories.map((repository) => {
    const slug = parseGitHubRepositoryUrl(repository.repositoryUrl);
    const normalizedOwner = slug.owner.toLowerCase();
    const normalizedRepo = slug.repo.toLowerCase();
    const id = `${normalizedOwner}-${normalizedRepo}`
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return {
      id,
      name: repository.name ?? slug.repo,
      description: repository.description ?? `${slug.owner}/${slug.repo} source evidence`,
      importance: repository.importance,
      source: { type: "github-url" as const, url: repository.repositoryUrl },
      defaultRef: repository.defaultRef,
      sandboxPath: `/workspace/watched/${id}`,
      accessMode: "sandbox-read" as const,
      allowedActions: [
        "clone",
        "read",
        "search",
        "inspect-diff",
        "run-readonly-checks",
      ] as const,
      pathFilters: repository.pathFilters,
      signals: repository.signals,
      provenanceLabel: `watched-repository:${normalizedOwner}/${normalizedRepo}`,
    };
  });
  if (new Set(watchedRepositories.map(({ id }) => id)).size !== watchedRepositories.length) {
    throw new Error("Watched repositories must resolve to unique repository identities.");
  }

  const contextRepositories = parsed.contextRepositories.map((repository) => {
    const slug = parseGitHubRepositoryUrl(repository.repositoryUrl);
    const normalizedOwner = slug.owner.toLowerCase();
    const normalizedRepo = slug.repo.toLowerCase();
    const id = `${normalizedOwner}-${normalizedRepo}`
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return {
      id,
      name: repository.name ?? slug.repo,
      description: repository.description ?? `${slug.owner}/${slug.repo} workspace context`,
      source: { type: "github-url" as const, url: repository.repositoryUrl },
      ref: repository.ref,
      sandboxPath: `/workspace/context/${id}`,
      accessMode: "sandbox-read" as const,
      allowedActions: [
        "clone",
        "read",
        "search",
        "inspect-diff",
        "run-readonly-checks",
      ] as const,
      pathFilters: repository.pathFilters,
      evidenceClass: repository.evidenceClass,
      canSupportPublicDocsClaim: repository.canSupportPublicDocsClaim,
      provenanceLabel: `context-repository:${normalizedOwner}/${normalizedRepo}`,
    };
  });
  if (new Set(contextRepositories.map(({ id }) => id)).size !== contextRepositories.length) {
    throw new Error("Context repositories must resolve to unique repository identities.");
  }

  return setupStateSchema.parse({
    version: SETUP_STATE_VERSION,
    workingRepositoryInput: repositoryInputSchema.parse({
      workingDocumentationRepository: {
        source: { type: "github-url", url: parsed.repositoryUrl },
        ref: parsed.ref,
        docsRoot: parsed.docsRoot,
      },
      watchedRepositories,
      contextRepositories,
    }),
    githubWriteback: { connector: parsed.githubConnector },
  });
}

function preflightCheck(preflight: GitHubWritebackPreflight) {
  return {
    id: "github-writeback" as const,
    status: preflight.status === "ready" ? "passed" as const : "blocked" as const,
    message: preflight.message,
  };
}
