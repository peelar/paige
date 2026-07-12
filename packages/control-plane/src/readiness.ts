import { getTokenResponse } from "@vercel/connect";
import { z } from "zod";

import {
  buildAppChannelStages,
  buildGitHubStages,
  classifyConnectSetupError,
  connectorStageSchema,
  readConnectorDeliveryVerification,
  type ConnectorStage,
} from "./connector-handoffs.js";
import { runGitHubWritebackPreflight } from "./github-preflight.js";
import {
  resolveEveRuntimeUrl,
  resolveLinearConnector,
  resolveSlackConnector,
} from "./provider-config.js";
import {
  getSetupStatus,
  readPersistedSetupStatus,
  readSetupState,
} from "./setup-state.js";

export const readinessStateSchema = z.enum([
  "configured",
  "reachable",
  "verified",
  "blocked",
  "unknown",
]);

export const readinessItemIdSchema = z.enum([
  "database",
  "working-repository",
  "github-writeback",
  "slack",
  "linear",
  "eve-runtime",
]);

export const readinessItemSchema = z.object({
  id: readinessItemIdSchema,
  label: z.string(),
  state: readinessStateSchema,
  ready: z.boolean(),
  summary: z.string(),
  source: z.string(),
  lastCheckedAt: z.string(),
  nextAction: z.string().nullable(),
  detail: z.array(z.string()),
  stages: z.array(connectorStageSchema),
});

export const readinessReportSchema = z.object({
  overall: z.enum(["ready", "attention", "blocked"]),
  checkedAt: z.string(),
  items: z.array(readinessItemSchema).length(6),
});

export type ReadinessState = z.infer<typeof readinessStateSchema>;
export type ReadinessItemId = z.infer<typeof readinessItemIdSchema>;
export type ReadinessItem = z.infer<typeof readinessItemSchema>;
export type ReadinessReport = z.infer<typeof readinessReportSchema>;

export type ReadinessObservation = {
  configured?: boolean | null;
  reachable?: boolean | null;
  verified?: boolean | null;
  blockedReason?: string;
  ready: boolean;
  summary: string;
  source: string;
  nextAction?: string | null;
  detail?: string[];
  stages?: ConnectorStage[];
};

export type ReadinessProbe = () => Promise<ReadinessObservation>;

export type ReadinessDependencies = {
  now: () => Date;
  probes: Record<ReadinessItemId, ReadinessProbe>;
};

const itemLabels: Record<ReadinessItemId, string> = {
  database: "Application database",
  "working-repository": "Working repository",
  "github-writeback": "GitHub writeback",
  slack: "Slack channel",
  linear: "Linear channel",
  "eve-runtime": "Eve runtime",
};

export function classifyReadinessObservation(
  observation: ReadinessObservation,
): ReadinessState {
  if (observation.blockedReason !== undefined) return "blocked";
  if (observation.verified === true) return "verified";
  if (observation.reachable === true) return "reachable";
  if (observation.configured === true) return "configured";
  if (observation.configured === false) return "blocked";
  return "unknown";
}

export async function collectReadinessReport(
  dependencies: ReadinessDependencies,
): Promise<ReadinessReport> {
  const checkedAt = dependencies.now().toISOString();
  const ids = readinessItemIdSchema.options;
  const observations = await Promise.all(
    ids.map(async (id): Promise<ReadinessItem> => {
      try {
        const observation = await dependencies.probes[id]();
        return readinessItemSchema.parse({
          id,
          label: itemLabels[id],
          state: classifyReadinessObservation(observation),
          ready: observation.ready,
          summary: observation.summary,
          source: observation.source,
          lastCheckedAt: checkedAt,
          nextAction: observation.nextAction ?? null,
          detail: observation.detail ?? [],
          stages: observation.stages ?? [],
        });
      } catch (error) {
        return readinessItemSchema.parse({
          id,
          label: itemLabels[id],
          state: "blocked",
          ready: false,
          summary: formatError(error),
          source: probeFailureSource[id],
          lastCheckedAt: checkedAt,
          nextAction: probeFailureAction[id],
          detail: [],
          stages: [],
        });
      }
    }),
  );

  return readinessReportSchema.parse({
    overall: observations.every(({ ready }) => ready)
      ? "ready"
      : observations.some(({ state }) => state === "blocked")
        ? "blocked"
        : "attention",
    checkedAt,
    items: observations,
  });
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  return collectReadinessReport(createProductionReadinessDependencies());
}

export function createProductionReadinessDependencies(
  env: NodeJS.ProcessEnv = process.env,
): ReadinessDependencies {
  return {
    now: () => new Date(),
    probes: {
      database: async () => {
        const status = await readPersistedSetupStatus();
        return {
          verified: true,
          ready: true,
          summary: "The app-owned database is reachable and all committed migrations are applied.",
          source: "Shared libSQL connection and Drizzle migration metadata",
          detail: [redactDatabaseLocation(status.statePath)],
        };
      },
      "working-repository": async () => {
        const status = await getSetupStatus();
        const repository = status.workingRepository;
        if (!status.docsMaintenanceReady || repository === undefined) {
          return {
            configured: false,
            blockedReason: status.issues
              .filter(({ capability }) => capability === "docs-maintenance")
              .map(({ message }) => message)
              .join(" ") || "Working repository setup is incomplete.",
            ready: false,
            summary: "The working documentation repository is not ready.",
            source: "Canonical workspace setup service",
            nextAction: status.issues.find(
              ({ capability }) => capability === "docs-maintenance",
            )?.nextAction ?? "Configure the working documentation repository.",
          };
        }

        return {
          configured: true,
          ready: true,
          summary: "The working documentation repository setup is structurally valid.",
          source: "Canonical workspace setup service",
          detail: [
            redactRepositoryUrl(repository.repositoryUrl),
            `Ref: ${repository.ref}`,
            repository.docsRoot === undefined
              ? "Docs root: detected during materialization"
              : `Docs root: ${repository.docsRoot}`,
          ],
        };
      },
      "github-writeback": async () => {
        const state = await readSetupState();
        if (state === null) {
          return {
            ...blocked(
              "Workspace setup is missing, so GitHub writeback cannot be checked.",
              "Canonical setup service and GitHub App installation preflight",
              "Configure the working repository and GitHub connector.",
            ),
            stages: buildGitHubStages({ status: "missing-connector" }),
          };
        }
        const result = await runGitHubWritebackPreflight({
          state,
          abortSignal: AbortSignal.timeout(5_000),
        });
        if (result.status !== "ready") {
          return {
            ...blocked(
              result.message,
              "Vercel Connect installation token and GitHub repository preflight",
              githubNextAction(result.status),
            ),
            stages: buildGitHubStages({ status: result.status }),
          };
        }
        return {
          verified: true,
          ready: true,
          summary: result.message,
          source: "Vercel Connect installation token and GitHub repository preflight",
          stages: buildGitHubStages({ status: result.status }),
        };
      },
      slack: () => probeSlack(env),
      linear: () => probeLinear(env),
      "eve-runtime": () => probeEveRuntime(env),
    },
  };
}

async function probeSlack(env: NodeJS.ProcessEnv): Promise<ReadinessObservation> {
  const connector = resolveSlackConnector(env);
  const delivery = await readConnectorDeliveryVerification({
    provider: "slack",
    env,
  });
  let token: Awaited<ReturnType<typeof getTokenResponse>>;
  try {
    token = await getTokenResponse(
      connector,
      { subject: { type: "app" } },
      { forceRefresh: true },
    );
  } catch (error) {
    const setup = classifyConnectSetupError(error);
    return {
      blockedReason: "Slack connector setup requires an operator action.",
      ready: false,
      summary: "Slack could not issue an app-scoped token for this deployment.",
      source: "Server-side Vercel Connect app-token check",
      nextAction: "Complete the first incomplete Slack installation stage, then recheck.",
      stages: buildAppChannelStages({ provider: "slack", ...setup, delivery }),
    };
  }

  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token.token}` },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json() as { ok?: boolean };
  const providerReachable = response.ok && body.ok === true;
  const stages = buildAppChannelStages({
    provider: "slack",
    connector: "verified",
    installation: providerReachable ? "verified" : "blocked",
    delivery,
  });
  if (!providerReachable) {
    return {
      blockedReason: "Slack rejected the app-scoped installation check.",
      ready: false,
      summary: "Slack issued a token, but auth.test did not verify the installation.",
      source: "Server-side Vercel Connect token and Slack auth.test",
      nextAction: "Review the Slack app installation in Vercel Connect, then recheck.",
      stages,
    };
  }

  return {
    configured: true,
    reachable: true,
    verified: delivery !== null,
    ready: delivery !== null,
    summary: delivery === null
      ? "The Slack connector can reach Slack, but inbound event delivery is not yet verified."
      : "Slack installation and inbound event delivery are verified.",
    source: "Server-side Vercel Connect token and Slack auth.test",
    nextAction: delivery === null
      ? "Attach the Slack trigger, mention Paige, then recheck this report."
      : null,
    detail: ["Credentials are server-only and are not included in this report."],
    stages,
  };
}

async function probeLinear(env: NodeJS.ProcessEnv): Promise<ReadinessObservation> {
  const connector = resolveLinearConnector(env);
  const delivery = await readConnectorDeliveryVerification({
    provider: "linear",
    env,
  });
  let token: Awaited<ReturnType<typeof getTokenResponse>>;
  try {
    token = await getTokenResponse(
      connector,
      { subject: { type: "app" } },
      { forceRefresh: true },
    );
  } catch (error) {
    const setup = classifyConnectSetupError(error);
    return {
      blockedReason: "Linear connector setup requires an operator action.",
      ready: false,
      summary: "Linear could not issue an app-scoped token for this deployment.",
      source: "Server-side Vercel Connect app-token check",
      nextAction: "Complete the first incomplete Linear installation stage, then recheck.",
      stages: buildAppChannelStages({ provider: "linear", ...setup, delivery }),
    };
  }
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "query ReadinessViewer { viewer { id } }" }),
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json() as { data?: { viewer?: { id?: string } }; errors?: unknown[] };
  const providerReachable =
    response.ok &&
    body.data?.viewer?.id !== undefined &&
    body.errors === undefined;
  const stages = buildAppChannelStages({
    provider: "linear",
    connector: "verified",
    installation: providerReachable ? "verified" : "blocked",
    delivery,
  });
  if (!providerReachable) {
    return {
      blockedReason: "Linear rejected the provider app installation check.",
      ready: false,
      summary: "Linear issued a token, but the viewer query did not verify the provider app.",
      source: "Server-side Vercel Connect token and Linear viewer query",
      nextAction: "Review the Linear provider app in Vercel Connect, then recheck.",
      stages,
    };
  }

  return {
    configured: true,
    reachable: true,
    verified: delivery !== null,
    ready: delivery !== null,
    summary: delivery === null
      ? "The Linear connector can reach Linear, but inbound Agent Session delivery is not yet verified."
      : "Linear provider app and Agent Session delivery are verified.",
    source: "Server-side Vercel Connect token and Linear viewer query",
    nextAction: delivery === null
      ? "Attach the Linear trigger, delegate an issue to Paige, then recheck this report."
      : null,
    detail: ["Credentials are server-only and are not included in this report."],
    stages,
  };
}

async function probeEveRuntime(env: NodeJS.ProcessEnv): Promise<ReadinessObservation> {
  const runtimeUrl = new URL(resolveEveRuntimeUrl(env));
  const healthUrl = new URL("/eve/v1/health", runtimeUrl);
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Eve health returned ${response.status}.`);

  return {
    reachable: true,
    ready: true,
    summary: "Eve answered its public health endpoint.",
    source: "GET /eve/v1/health",
    detail: [`Runtime origin: ${runtimeUrl.origin}`],
  };
}

function blocked(
  summary: string,
  source: string,
  nextAction: string,
): ReadinessObservation {
  return {
    blockedReason: summary,
    ready: false,
    summary,
    source,
    nextAction,
  };
}

function githubNextAction(
  status: "missing-connector" | "connector-unavailable" | "app-not-installed" | "repository-not-granted" | "insufficient-permissions",
): string {
  switch (status) {
    case "missing-connector":
      return "Configure the server-side GitHub connector.";
    case "connector-unavailable":
      return "Reconnect the GitHub connector and retry the preflight.";
    case "app-not-installed":
      return "Install or authorize the GitHub App.";
    case "repository-not-granted":
      return "Grant the GitHub App access to the working documentation repository.";
    case "insufficient-permissions":
      return "Grant contents:write and pull_requests:write to the GitHub App.";
  }
}

function redactRepositoryUrl(value: string): string {
  const url = new URL(value);
  return `Repository: ${url.hostname}${url.pathname.replace(/\.git$/, "")}`;
}

function redactDatabaseLocation(value: string): string {
  return value.startsWith("file:")
    ? "Storage: local app database"
    : "Storage: server-side DOCS_AGENT_DATABASE_URL";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const probeFailureSource: Record<ReadinessItemId, string> = {
  database: "Shared libSQL connection and Drizzle migration metadata",
  "working-repository": "Canonical workspace setup service",
  "github-writeback": "GitHub App installation-token preflight",
  slack: "Vercel Connect and Slack auth.test",
  linear: "Vercel Connect and Linear viewer query",
  "eve-runtime": "GET /eve/v1/health",
};

const probeFailureAction: Record<ReadinessItemId, string> = {
  database: "Check DOCS_AGENT_DATABASE_URL and run pnpm db:migrate.",
  "working-repository": "Restore database access, then validate workspace setup.",
  "github-writeback": "Check the connector, app installation, repository grant, and permissions.",
  slack: "Check the Slack connector installation, then retry the provider check.",
  linear: "Check the Linear connector installation, then retry the provider check.",
  "eve-runtime": "Start Docs Agent with pnpm dev --no-ui and retry the health check.",
};
