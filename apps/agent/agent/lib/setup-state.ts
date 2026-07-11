import { eq } from "drizzle-orm";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  docsAgentDatabaseLocation,
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.js";
import { workspaceSetup } from "./db/schema.js";
import {
  GITHUB_CONNECTOR_ENV,
  formatUnknownError,
  gitHubWritebackPermissions,
  githubApiRequest,
  parseGitHubRepositoryUrl,
  resolveGitHubAppInstallationToken,
  resolveGitHubConnector,
  type ConnectTokenResponse,
  type GitHubApiErrorResult,
} from "./github-app-client.js";
import {
  repositoryInputSchema,
  type RepositoryInput,
  type WatchedRepository,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";

export const SETUP_STATE_VERSION = 1;
export const DEFAULT_WORKSPACE_ID = "default";
export { GITHUB_CONNECTOR_ENV, resolveGitHubConnector };
export { resolveGitHubAppInstallationToken as resolveGitHubWritebackToken };

const docsMaintenanceRequiredActions = [
  "clone",
  "read",
  "search",
  "patch",
  "run-checks",
  "export-diff",
] as const satisfies readonly WorkingDocumentationRepository["allowedActions"][number][];

const githubWritebackRequiredActions = [
  ...docsMaintenanceRequiredActions,
  "publish-pr",
] as const satisfies readonly WorkingDocumentationRepository["allowedActions"][number][];

const watchedRepositoryRequiredActions = [
  "clone",
  "read",
  "search",
] as const satisfies readonly WatchedRepository["allowedActions"][number][];

const githubWritebackSetupSchema = z
  .object({
    connector: z.string().trim().min(1).optional(),
  })
  .default({});

export const setupStateSchema = z.object({
  version: z.literal(SETUP_STATE_VERSION),
  workingRepositoryInput: repositoryInputSchema.optional(),
  githubWriteback: githubWritebackSetupSchema,
});

export const setupIssueSchema = z.object({
  code: z.enum([
    "setup-state-missing",
    "setup-state-invalid",
    "working-repository-missing",
    "working-repository-invalid",
    "working-repository-action-missing",
    "github-writeback-action-missing",
    "github-connector-missing",
    "github-connector-unavailable",
    "github-app-not-installed",
    "github-repository-not-granted",
    "github-insufficient-permissions",
    "github-writeback-ready",
  ]),
  capability: z.enum(["docs-maintenance", "github-writeback"]),
  message: z.string(),
  nextAction: z.string(),
});

export const setupStatusSchema = z.object({
  ready: z.boolean(),
  docsMaintenanceReady: z.boolean(),
  githubWritebackReady: z.boolean(),
  setupMode: z.boolean(),
  statePath: z.string(),
  workingRepository: z
    .object({
      repositoryUrl: z.string(),
      ref: z.string(),
      docsRoot: z.string().optional(),
      sandboxPath: z.string(),
    })
    .optional(),
  watchedRepositories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      repositoryUrl: z.string(),
      defaultRef: z.string(),
      sandboxPath: z.string(),
      signals: z.array(z.string()),
    }),
  ),
  githubWriteback: z.object({
    connectorConfigured: z.boolean(),
    connector: z.string().optional(),
    preflight: z
      .object({
        checked: z.boolean(),
        status: z.enum([
          "not-checked",
          "ready",
          "missing-connector",
          "connector-unavailable",
          "app-not-installed",
          "repository-not-granted",
          "insufficient-permissions",
        ]),
        message: z.string(),
      })
      .default({
        checked: false,
        status: "not-checked",
        message: "GitHub writeback preflight has not been run.",
      }),
  }),
  issues: z.array(setupIssueSchema),
});

export type SetupState = z.infer<typeof setupStateSchema>;
export type ReadySetupState = SetupState & {
  workingRepositoryInput: RepositoryInput;
};
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type SetupIssue = z.infer<typeof setupIssueSchema>;
export type SetupCapability = "docs-maintenance" | "github-writeback";

export class SetupRequiredError extends Error {
  readonly status: SetupStatus;

  constructor(capability: SetupCapability, status: SetupStatus) {
    super(formatSetupRequiredMessage(capability, status));
    this.name = "SetupRequiredError";
    this.status = status;
  }
}

export async function readSetupState(): Promise<SetupState | null> {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select()
      .from(workspaceSetup)
      .where(eq(workspaceSetup.id, DEFAULT_WORKSPACE_ID))
      .limit(1);

    const row = rows[0];
    if (row !== undefined) return parseSetupStateRow(row);

    return null;
  });
}

export async function saveSetupState(state: SetupState): Promise<SetupState> {
  const parsed = setupStateSchema.parse(state);
  await writeSetupStateRow(parsed);
  return parsed;
}

async function writeSetupStateRow(state: SetupState): Promise<void> {
  await withDocsAgentDatabase(async (db) => {
    await upsertSetupStateRow(db, state);
  });
}

async function upsertSetupStateRow(
  db: DocsAgentDatabase,
  state: SetupState,
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .insert(workspaceSetup)
    .values({
      id: DEFAULT_WORKSPACE_ID,
      version: state.version,
      workingRepositoryInput: state.workingRepositoryInput ?? null,
      githubWriteback: state.githubWriteback,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceSetup.id,
      set: {
        version: state.version,
        workingRepositoryInput: state.workingRepositoryInput ?? null,
        githubWriteback: state.githubWriteback,
        updatedAt: now,
      },
    });
}

function parseSetupStateRow(row: typeof workspaceSetup.$inferSelect): SetupState {
  return setupStateSchema.parse({
    version: row.version,
    workingRepositoryInput: row.workingRepositoryInput ?? undefined,
    githubWriteback: row.githubWriteback,
  });
}

export function repositoryInputForSetup(input: RepositoryInput): RepositoryInput {
  const parsed = repositoryInputSchema.parse(input);

  return {
    workingDocumentationRepository: parsed.workingDocumentationRepository,
    watchedRepositories: parsed.watchedRepositories,
    contextRepositories: [],
    externalContext: [],
  };
}

export async function saveWorkingRepositorySetup(input: RepositoryInput): Promise<SetupState> {
  const current = await readSetupState().catch(() => null);

  return saveSetupState({
    version: SETUP_STATE_VERSION,
    workingRepositoryInput: repositoryInputForSetup(input),
    githubWriteback: current?.githubWriteback ?? {},
  });
}

export async function saveGitHubWritebackSetup(input: {
  connector?: string;
}): Promise<SetupState> {
  const current = await readSetupState().catch(() => null);
  const connector = input.connector?.trim() || current?.githubWriteback.connector;

  return saveSetupState({
    version: SETUP_STATE_VERSION,
    workingRepositoryInput: current?.workingRepositoryInput,
    githubWriteback: {
      connector,
    },
  });
}

export async function getSetupStatus(): Promise<SetupStatus> {
  try {
    const state = await readSetupState();
    return evaluateSetupState(state);
  } catch (error) {
    return buildInvalidSetupStatus(error instanceof Error ? error.message : String(error));
  }
}

export async function requireSetupReady(
  capability: SetupCapability,
): Promise<ReadySetupState> {
  const state = await readSetupState();
  const status = evaluateSetupState(state);
  const ready =
    capability === "docs-maintenance"
      ? status.docsMaintenanceReady
      : status.githubWritebackReady;

  if (!ready || state?.workingRepositoryInput === undefined) {
    throw new SetupRequiredError(capability, status);
  }

  return state as ReadySetupState;
}

export async function preflightGitHubWritebackSetup(
  ctx: ToolContext,
  state: SetupState,
): Promise<SetupStatus> {
  const status = evaluateSetupState(state);
  if (state.workingRepositoryInput === undefined) return status;

  const connector = resolveGitHubConnector(state);
  if (connector.trim() === "") {
    return withGitHubPreflight(status, {
      status: "missing-connector",
      message: "No GitHub connector is configured for writeback.",
      issue: {
        code: "github-connector-missing",
        capability: "github-writeback",
        message: "GitHub writeback needs an app-scoped GitHub connector.",
        nextAction:
          "Configure GitHub writeback setup before attempting to publish a draft PR.",
      },
    });
  }

  const repository = state.workingRepositoryInput.workingDocumentationRepository;
  const slug = parseGitHubRepositoryUrl(repository.source.url);

  let tokenResponse: ConnectTokenResponse;
  let token: string;
  try {
    tokenResponse = await resolveGitHubAppInstallationToken({ connector, slug });
    token = tokenResponse.token;
  } catch (error) {
    return withGitHubPreflight(status, classifyConnectorError(error));
  }

  const installation = await githubApiRequest<GitHubInstallationRepositoriesResponse>({
    token,
    path: "/installation/repositories?per_page=100",
    abortSignal: ctx.abortSignal,
  });

  if (!installation.ok) {
    return withGitHubPreflight(status, classifyInstallationError(installation));
  }

  const repositoryAccess = await githubApiRequest<GitHubRepositoryResponse>({
    token,
    path: `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`,
    abortSignal: ctx.abortSignal,
  });

  if (!repositoryAccess.ok && repositoryAccess.status === 404) {
    return withGitHubPreflight(status, {
      status: "repository-not-granted",
      message:
        "The GitHub App token is valid, but the configured repository is not granted to the app installation.",
      issue: {
        code: "github-repository-not-granted",
        capability: "github-writeback",
        message:
          "The configured working documentation repository is not available to the GitHub App installation.",
        nextAction:
          "Ask a GitHub admin to grant the app access to the configured working documentation repository, then retry setup validation.",
      },
    });
  }

  if (!repositoryAccess.ok) {
    return withGitHubPreflight(status, {
      status: "connector-unavailable",
      message: repositoryAccess.message,
      issue: {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector could not validate repository access.",
        nextAction: "Retry setup validation after checking the GitHub connector runtime state.",
      },
    });
  }

  const permissions = gitHubWritebackPermissions(tokenResponse);
  if (permissions.contents !== "write" || permissions.pull_requests !== "write") {
    return withGitHubPreflight(status, {
      status: "insufficient-permissions",
      message:
        "The GitHub App installation is available, but it does not have contents:write and pull_requests:write permissions.",
      issue: {
        code: "github-insufficient-permissions",
        capability: "github-writeback",
        message:
          "GitHub writeback needs contents:write and pull_requests:write permissions on the working documentation repository.",
        nextAction:
          "Update the GitHub App installation permissions, then retry setup validation.",
      },
    });
  }

  return withGitHubPreflight(status, {
    status: "ready",
    message: "GitHub writeback is ready for the configured working documentation repository.",
    issue: {
      code: "github-writeback-ready",
      capability: "github-writeback",
      message: "GitHub writeback preflight passed.",
      nextAction: "Continue with the approved publish flow.",
    },
  });
}

export function buildSetupInstructions(status: SetupStatus): string {
  if (!status.docsMaintenanceReady) {
    return [
      "## Setup State",
      "",
      "The workspace setup is incomplete. Enter setup mode when the user asks for docs maintenance.",
      "",
      "Ordinary conversation is not docs maintenance. Do not ask for repository setup until a docs task is clear.",
      "Ask for the working documentation repository GitHub URL if the user has not provided it.",
      "When the user provides a URL, call `configure_working_repository`. Use provided ref/docs root values, but do not require them: ref defaults to `main`, and docs root is detected when the sandbox checkout is first materialized.",
      "Do not call docs-maintenance or publish tools until setup is ready.",
      "",
      "Current setup issues:",
      ...status.issues.map((issue) => `- ${issue.message} Next: ${issue.nextAction}`),
    ].join("\n");
  }

  const repository = status.workingRepository;
  const lines = [
    "## Setup State",
    "",
    `Working documentation repository is configured: ${repository?.repositoryUrl ?? "unknown"} (${repository?.ref ?? "main"}).`,
  ];

  if (repository?.docsRoot !== undefined) {
    lines.push(`Configured docs root: ${repository.docsRoot}.`);
  } else {
    lines.push("Docs root will be detected during sandbox materialization.");
  }

  lines.push(
    "For normal docs maintenance, use the configured repository instead of asking for the same setup again.",
  );

  if (status.watchedRepositories.length > 0) {
    lines.push(
      `Configured watched repositories for read-only source evidence: ${status.watchedRepositories
        .map((watchedRepository) => `${watchedRepository.name} (${watchedRepository.repositoryUrl})`)
        .join(", ")}.`,
    );
    lines.push(
      "For watched repository scans, use the configured watched repositories as read-only evidence sources and keep writeback limited to the working documentation repository.",
    );
  }

  if (!status.githubWritebackReady) {
    lines.push(
      "If the user requests GitHub draft PR writeback, finish GitHub writeback setup first by calling `get_setup_status` with `checkGitHubWriteback: true` or `configure_github_writeback`.",
    );
  }

  return lines.join("\n");
}

function evaluateSetupState(state: SetupState | null): SetupStatus {
  if (state === null) {
    return {
      ready: false,
      docsMaintenanceReady: false,
      githubWritebackReady: false,
      setupMode: true,
      statePath: setupStateLocation(),
      githubWriteback: {
        connectorConfigured: false,
        preflight: {
          checked: false,
          status: "not-checked",
          message: "GitHub writeback preflight has not been run.",
        },
      },
      watchedRepositories: [],
      issues: [
        {
          code: "setup-state-missing",
          capability: "docs-maintenance",
          message: "Workspace setup has not been configured yet.",
          nextAction: "Collect the working documentation repository GitHub URL.",
        },
        {
          code: "working-repository-missing",
          capability: "docs-maintenance",
          message: "Working documentation repository is missing.",
          nextAction: "Call configure_working_repository after the user provides a GitHub URL.",
        },
      ],
    };
  }

  const issues: SetupIssue[] = [];
  const repositoryInputResult = state.workingRepositoryInput === undefined
    ? null
    : repositoryInputSchema.safeParse(state.workingRepositoryInput);

  if (state.workingRepositoryInput === undefined) {
    issues.push({
      code: "working-repository-missing",
      capability: "docs-maintenance",
      message: "Working documentation repository is missing.",
      nextAction: "Call configure_working_repository after the user provides a GitHub URL.",
    });
  } else if (repositoryInputResult?.success !== true) {
    issues.push({
      code: "working-repository-invalid",
      capability: "docs-maintenance",
      message: "Working documentation repository setup is invalid.",
      nextAction: "Re-run configure_working_repository with a supported GitHub URL.",
    });
  }

  const repository = repositoryInputResult?.success
    ? repositoryInputResult.data.workingDocumentationRepository
    : undefined;

  if (repository !== undefined) {
    for (const action of docsMaintenanceRequiredActions) {
      if (!repository.allowedActions.includes(action)) {
        issues.push({
          code: "working-repository-action-missing",
          capability: "docs-maintenance",
          message: `Working repository setup is missing required action: ${action}.`,
          nextAction: "Re-run configure_working_repository to refresh workspace setup.",
        });
      }
    }

    for (const action of githubWritebackRequiredActions) {
      if (!repository.allowedActions.includes(action)) {
        issues.push({
          code: "github-writeback-action-missing",
          capability: "github-writeback",
          message: `GitHub writeback setup is missing required action: ${action}.`,
          nextAction:
            "Re-run configure_working_repository or configure_github_writeback before publishing.",
        });
      }
    }
  }

  const watchedRepositories = repositoryInputResult?.success
    ? repositoryInputResult.data.watchedRepositories
    : [];

  for (const watchedRepository of watchedRepositories) {
    for (const action of watchedRepositoryRequiredActions) {
      if (!watchedRepository.allowedActions.includes(action)) {
        issues.push({
          code: "working-repository-action-missing",
          capability: "docs-maintenance",
          message: `Watched repository ${watchedRepository.id} is missing required read-only action: ${action}.`,
          nextAction:
            "Re-run configure_working_repository with a complete watched repository config.",
        });
      }
    }
  }

  const connector = resolveGitHubConnector(state);
  if (connector.trim() === "") {
    issues.push({
      code: "github-connector-missing",
      capability: "github-writeback",
      message: "GitHub writeback connector is missing.",
      nextAction: "Configure GitHub writeback before publishing.",
    });
  }

  const docsMaintenanceReady = !issues.some(
    (issue) => issue.capability === "docs-maintenance",
  );
  const githubWritebackReady =
    docsMaintenanceReady &&
    !issues.some((issue) => issue.capability === "github-writeback");

  return {
    ready: docsMaintenanceReady,
    docsMaintenanceReady,
    githubWritebackReady,
    setupMode: !docsMaintenanceReady,
    statePath: setupStateLocation(),
    workingRepository:
      repository === undefined
        ? undefined
        : {
            repositoryUrl: repository.source.url,
            ref: repository.ref,
            docsRoot: repository.docsRoot,
            sandboxPath: repository.sandboxPath,
          },
    watchedRepositories: watchedRepositories.map((watchedRepository) => ({
      id: watchedRepository.id,
      name: watchedRepository.name,
      repositoryUrl: watchedRepository.source.url,
      defaultRef: watchedRepository.defaultRef,
      sandboxPath: watchedRepository.sandboxPath,
      signals: watchedRepository.signals,
    })),
    githubWriteback: {
      connectorConfigured: connector.trim() !== "",
      connector,
      preflight: {
        checked: false,
        status: "not-checked",
        message: "GitHub writeback preflight has not been run.",
      },
    },
    issues,
  };
}

function buildInvalidSetupStatus(message: string): SetupStatus {
  return {
    ready: false,
    docsMaintenanceReady: false,
    githubWritebackReady: false,
    setupMode: true,
    statePath: setupStateLocation(),
    githubWriteback: {
      connectorConfigured: false,
      preflight: {
        checked: false,
        status: "not-checked",
        message: "GitHub writeback preflight has not been run.",
      },
    },
    watchedRepositories: [],
    issues: [
      {
        code: "setup-state-invalid",
        capability: "docs-maintenance",
        message,
        nextAction: "Re-run configure_working_repository with a supported GitHub URL.",
      },
    ],
  };
}

function withGitHubPreflight(
  status: SetupStatus,
  input: {
    status: SetupStatus["githubWriteback"]["preflight"]["status"];
    message: string;
    issue: SetupIssue;
  },
): SetupStatus {
  const nextIssues = status.issues.filter(
    (issue) => issue.code !== "github-writeback-ready",
  );

  if (input.issue.code !== "github-writeback-ready") {
    nextIssues.push(input.issue);
  }

  const githubWritebackReady =
    status.docsMaintenanceReady &&
    input.status === "ready" &&
    !nextIssues.some((issue) => issue.capability === "github-writeback");

  return {
    ...status,
    githubWritebackReady,
    githubWriteback: {
      ...status.githubWriteback,
      preflight: {
        checked: true,
        status: input.status,
        message: input.message,
      },
    },
    issues: nextIssues,
  };
}

function classifyConnectorError(error: unknown): {
  status: SetupStatus["githubWriteback"]["preflight"]["status"];
  message: string;
  issue: SetupIssue;
} {
  const message = formatUnknownError(error);
  const lower = message.toLowerCase();

  if (lower.includes("connector") && lower.includes("not found")) {
    return {
      status: "missing-connector",
      message,
      issue: {
        code: "github-connector-missing",
        capability: "github-writeback",
        message: "The configured GitHub connector was not found.",
        nextAction: "Attach or configure the GitHub connector for this runtime.",
      },
    };
  }

  if (
    lower.includes("not available") ||
    lower.includes("environment") ||
    lower.includes("runtime") ||
    lower.includes("project")
  ) {
    return {
      status: "connector-unavailable",
      message,
      issue: {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector is not available to this runtime environment.",
        nextAction:
          "Attach the connector to the current project/environment, then retry setup validation.",
      },
    };
  }

  return {
    status: "app-not-installed",
    message,
    issue: {
      code: "github-app-not-installed",
      capability: "github-writeback",
      message:
        "GitHub writeback could not resolve an app-scoped GitHub token. The GitHub App may need to be installed or authorized.",
      nextAction:
        "Complete the GitHub authorization challenge or ask a GitHub admin to install the app, then retry setup validation.",
    },
  };
}

function classifyInstallationError(
  result: GitHubApiErrorResult,
): {
  status: SetupStatus["githubWriteback"]["preflight"]["status"];
  message: string;
  issue: SetupIssue;
} {
  if (result.status === 401 || result.status === 403) {
    return {
      status: "connector-unavailable",
      message: result.message,
      issue: {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector token could not access installation metadata.",
        nextAction: "Reconnect the GitHub connector for this runtime, then retry setup validation.",
      },
    };
  }

  if (result.status === 404) {
    return {
      status: "app-not-installed",
      message: result.message,
      issue: {
        code: "github-app-not-installed",
        capability: "github-writeback",
        message: "No GitHub App installation is visible for the resolved connector token.",
        nextAction: "Ask a GitHub admin to install the app, then retry setup validation.",
      },
    };
  }

  return {
    status: "connector-unavailable",
    message: result.message,
    issue: {
      code: "github-connector-unavailable",
      capability: "github-writeback",
      message: "GitHub writeback setup could not be validated.",
      nextAction: "Retry setup validation after checking the GitHub connector runtime state.",
    },
  };
}

function formatSetupRequiredMessage(
  capability: SetupCapability,
  status: SetupStatus,
): string {
  const relevantIssues = status.issues.filter((issue) => issue.capability === capability);
  const issues = relevantIssues.length > 0 ? relevantIssues : status.issues;
  const detail = issues.map((issue) => issue.message).join(" ");

  return `Setup required before ${capability}: ${detail}`;
}

function setupStateLocation(): string {
  return docsAgentDatabaseLocation();
}

type GitHubInstallationRepositoriesResponse = {
  repositories: unknown[];
};

type GitHubRepositoryResponse = {
  full_name: string;
};
