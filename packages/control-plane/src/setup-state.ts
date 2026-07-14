import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  docsAgentDatabaseLocation,
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.ts";
import { workspaceSetup, workspaceSetupEvents } from "./db/schema.ts";
import {
  repositoryInputSchema,
  type RepositoryInput,
  type ContextRepository,
  type WatchedRepository,
  type WorkingDocumentationRepository,
} from "./repository-contract.ts";

export const SETUP_STATE_VERSION = 1;
export const DEFAULT_WORKSPACE_ID = "default";
export const GITHUB_CONNECTOR_ENV = "DOCS_AGENT_GITHUB_CONNECTOR";

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

const contextRepositoryRequiredActions = [
  "clone",
  "read",
  "search",
] as const satisfies readonly ContextRepository["allowedActions"][number][];

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
  contextRepositories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      repositoryUrl: z.string(),
      ref: z.string(),
      sandboxPath: z.string(),
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

export const persistedSetupStatusSchema = z.object({
  configured: z.boolean(),
  statePath: z.string(),
  state: setupStateSchema.nullable(),
});

export const setupAuditActorSchema = z.object({
  id: z.string().trim().min(1),
  githubLogin: z.string().trim().min(1).transform((value) => value.toLowerCase()),
});

export const setupAuditEventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  actor: setupAuditActorSchema,
  action: z.string(),
  setupSnapshot: setupStateSchema,
  createdAt: z.string(),
});

export type SetupState = z.infer<typeof setupStateSchema>;
export type PersistedSetupStatus = z.infer<typeof persistedSetupStatusSchema>;
export type ReadySetupState = SetupState & {
  workingRepositoryInput: RepositoryInput;
};
export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type SetupIssue = z.infer<typeof setupIssueSchema>;
export type SetupCapability = "docs-maintenance" | "github-writeback";
export type SetupAuditActor = z.infer<typeof setupAuditActorSchema>;
export type SetupAuditEvent = z.infer<typeof setupAuditEventSchema>;

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
    if (row === undefined) return null;

    return parseSetupStateRow(row);
  });
}

export async function readPersistedSetupStatus(): Promise<PersistedSetupStatus> {
  const state = await readSetupState();

  return persistedSetupStatusSchema.parse({
    configured: state !== null,
    statePath: docsAgentDatabaseLocation(),
    state,
  });
}

export async function readSetupAuditEvents(
  limit = 50,
): Promise<SetupAuditEvent[]> {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select()
      .from(workspaceSetupEvents)
      .where(eq(workspaceSetupEvents.workspaceId, DEFAULT_WORKSPACE_ID))
      .orderBy(desc(workspaceSetupEvents.createdAt), desc(workspaceSetupEvents.id))
      .limit(Math.max(1, Math.min(limit, 100)));

    return rows.map((row) => setupAuditEventSchema.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      actor: {
        id: row.actorId,
        githubLogin: row.actorLogin,
      },
      action: row.action,
      setupSnapshot: row.setupSnapshot,
      createdAt: row.createdAt,
    }));
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
  const ready = capability === "docs-maintenance"
    ? status.docsMaintenanceReady
    : status.githubWritebackReady;

  if (!ready || state?.workingRepositoryInput === undefined) {
    throw new SetupRequiredError(capability, status);
  }

  return state as ReadySetupState;
}

export function resolveGitHubConnector(
  state?: { githubWriteback?: { connector?: string } } | null,
): string {
  return (
    process.env[GITHUB_CONNECTOR_ENV]?.trim() ||
    state?.githubWriteback?.connector?.trim() ||
    ""
  );
}

export function evaluateSetupState(state: SetupState | null): SetupStatus {
  if (state === null) {
    return {
      ready: false,
      docsMaintenanceReady: false,
      githubWritebackReady: false,
      setupMode: true,
      statePath: docsAgentDatabaseLocation(),
      githubWriteback: {
        connectorConfigured: false,
        preflight: {
          checked: false,
          status: "not-checked",
          message: "GitHub writeback preflight has not been run.",
        },
      },
      watchedRepositories: [],
      contextRepositories: [],
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

  const contextRepositories = repositoryInputResult?.success
    ? repositoryInputResult.data.contextRepositories
    : [];
  for (const contextRepository of contextRepositories) {
    for (const action of contextRepositoryRequiredActions) {
      if (!contextRepository.allowedActions.includes(action)) {
        issues.push({
          code: "working-repository-action-missing",
          capability: "docs-maintenance",
          message: `Context repository ${contextRepository.id} is missing required read-only action: ${action}.`,
          nextAction:
            "Re-run workspace setup with a complete context repository configuration.",
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
    statePath: docsAgentDatabaseLocation(),
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
    contextRepositories: contextRepositories.map((contextRepository) => ({
      id: contextRepository.id,
      name: contextRepository.name,
      repositoryUrl: contextRepository.source.url,
      ref: contextRepository.ref,
      sandboxPath: contextRepository.sandboxPath,
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
    statePath: docsAgentDatabaseLocation(),
    githubWriteback: {
      connectorConfigured: false,
      preflight: {
        checked: false,
        status: "not-checked",
        message: "GitHub writeback preflight has not been run.",
      },
    },
    watchedRepositories: [],
    contextRepositories: [],
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

function formatSetupRequiredMessage(
  capability: SetupCapability,
  status: SetupStatus,
): string {
  const relevantIssues = status.issues.filter((issue) => issue.capability === capability);
  const issues = relevantIssues.length > 0 ? relevantIssues : status.issues;
  const detail = issues.map((issue) => issue.message).join(" ");

  return `Setup required before ${capability}: ${detail}`;
}

export async function saveSetupState(
  state: SetupState,
  audit?: { actor: SetupAuditActor; action: string },
): Promise<SetupState> {
  const parsed = setupStateSchema.parse(state);
  await writeSetupStateRow(parsed, audit);
  return parsed;
}

export function repositoryInputForSetup(input: RepositoryInput): RepositoryInput {
  const parsed = repositoryInputSchema.parse(input);

  return {
    workingDocumentationRepository: parsed.workingDocumentationRepository,
    watchedRepositories: parsed.watchedRepositories,
    contextRepositories: parsed.contextRepositories,
    externalContext: [],
  };
}

export async function saveWorkingRepositorySetup(
  input: RepositoryInput,
): Promise<SetupState> {
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
    githubWriteback: { connector },
  });
}

async function writeSetupStateRow(
  state: SetupState,
  audit?: { actor: SetupAuditActor; action: string },
): Promise<void> {
  await withDocsAgentDatabase(async (db) => {
    if (audit === undefined) {
      await upsertSetupStateRow(db, state);
      return;
    }

    const actor = setupAuditActorSchema.parse(audit.actor);
    const action = z.string().trim().min(1).parse(audit.action);
    await db.transaction(async (tx) => {
      await upsertSetupStateRow(tx, state);
      await tx.insert(workspaceSetupEvents).values({
        id: randomUUID(),
        workspaceId: DEFAULT_WORKSPACE_ID,
        actorId: actor.id,
        actorLogin: actor.githubLogin,
        action,
        setupSnapshot: state,
        createdAt: new Date().toISOString(),
      });
    });
  });
}

async function upsertSetupStateRow(
  db: Pick<DocsAgentDatabase, "insert">,
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
