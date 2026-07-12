import { createHash } from "node:crypto";

import {
  ConnectError,
  ConnectorInstallationRequiredError,
  NoValidTokenError,
} from "@vercel/connect";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.js";
import { connectorDeliveryVerifications } from "./db/schema.js";
import {
  resolveLinearConnector,
  resolveSlackConnector,
} from "./provider-config.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";

export const connectorProviderSchema = z.enum(["slack", "linear", "github"]);
export const connectorStageIdSchema = z.enum([
  "connector",
  "installation",
  "trigger",
  "grant",
]);
export const connectorStageStateSchema = z.enum([
  "verified",
  "action-required",
  "blocked",
  "unknown",
  "not-applicable",
]);
export const connectorHandoffActionSchema = z.object({
  kind: z.enum(["terminal", "browser", "provider"]),
  label: z.string(),
  command: z.string().optional(),
  href: z.string().url().startsWith("https://").optional(),
  humanRequired: z.boolean(),
});
export const connectorStageSchema = z.object({
  id: connectorStageIdSchema,
  label: z.string(),
  state: connectorStageStateSchema,
  summary: z.string(),
  action: connectorHandoffActionSchema.nullable(),
});
export const connectorDeliveryEvidenceSchema = z.enum([
  "slack-verified-webhook",
  "linear-agent-session-webhook",
]);
export const connectorDeliveryVerificationSchema = z.object({
  provider: z.enum(["slack", "linear"]),
  evidence: connectorDeliveryEvidenceSchema,
  verifiedAt: z.string().datetime(),
});

export type ConnectorProvider = z.infer<typeof connectorProviderSchema>;
export type ConnectorStage = z.infer<typeof connectorStageSchema>;
export type ConnectorStageState = z.infer<typeof connectorStageStateSchema>;
export type ConnectorDeliveryVerification = z.infer<
  typeof connectorDeliveryVerificationSchema
>;

type AppChannelProvider = "slack" | "linear";
export type AppChannelProbe = {
  provider: AppChannelProvider;
  connector: "verified" | "missing" | "blocked";
  installation: "verified" | "required" | "blocked" | "unknown";
  delivery: ConnectorDeliveryVerification | null;
};

const stageLabels: Record<z.infer<typeof connectorStageIdSchema>, string> = {
  connector: "Connector",
  installation: "Provider installation",
  trigger: "Inbound trigger",
  grant: "Relevant grant",
};

const connectDashboardUrl =
  "https://vercel.com/d?to=/%5Bteam%5D/~/connect&title=Go+to+Connect";

export async function recordConnectorDeliveryVerification(input: {
  provider: AppChannelProvider;
  evidence: z.infer<typeof connectorDeliveryEvidenceSchema>;
  env?: NodeJS.ProcessEnv;
  verifiedAt?: Date;
}): Promise<ConnectorDeliveryVerification> {
  const provider = connectorDeliveryVerificationSchema.shape.provider.parse(
    input.provider,
  );
  const connector = resolveAppChannelConnector(provider, input.env);
  const verifiedAt = (input.verifiedAt ?? new Date()).toISOString();

  await withDocsAgentDatabase(async (db) => {
    await db
      .insert(connectorDeliveryVerifications)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        provider,
        connectorFingerprint: connectorFingerprint(connector),
        evidence: input.evidence,
        verifiedAt,
        updatedAt: verifiedAt,
      })
      .onConflictDoUpdate({
        target: [
          connectorDeliveryVerifications.workspaceId,
          connectorDeliveryVerifications.provider,
        ],
        set: {
          connectorFingerprint: connectorFingerprint(connector),
          evidence: input.evidence,
          verifiedAt,
          updatedAt: verifiedAt,
        },
      });
  });

  return connectorDeliveryVerificationSchema.parse({
    provider,
    evidence: input.evidence,
    verifiedAt,
  });
}

export async function readConnectorDeliveryVerification(input: {
  provider: AppChannelProvider;
  env?: NodeJS.ProcessEnv;
}): Promise<ConnectorDeliveryVerification | null> {
  const provider = connectorDeliveryVerificationSchema.shape.provider.parse(
    input.provider,
  );
  const connector = resolveAppChannelConnector(provider, input.env);
  const rows = await withDocsAgentDatabase((db) =>
    db
      .select({
        connectorFingerprint:
          connectorDeliveryVerifications.connectorFingerprint,
        evidence: connectorDeliveryVerifications.evidence,
        verifiedAt: connectorDeliveryVerifications.verifiedAt,
      })
      .from(connectorDeliveryVerifications)
      .where(
        and(
          eq(
            connectorDeliveryVerifications.workspaceId,
            DEFAULT_WORKSPACE_ID,
          ),
          eq(connectorDeliveryVerifications.provider, provider),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  if (
    row === undefined ||
    row.connectorFingerprint !== connectorFingerprint(connector)
  ) {
    return null;
  }

  return connectorDeliveryVerificationSchema.parse({
    provider,
    evidence: row.evidence,
    verifiedAt: row.verifiedAt,
  });
}

export function classifyConnectSetupError(
  error: unknown,
): Pick<AppChannelProbe, "connector" | "installation"> {
  if (
    error instanceof ConnectorInstallationRequiredError ||
    errorName(error) === "ConnectorInstallationRequiredError"
  ) {
    return { connector: "missing", installation: "unknown" };
  }

  if (
    error instanceof NoValidTokenError ||
    errorName(error) === "NoValidTokenError"
  ) {
    return { connector: "verified", installation: "required" };
  }

  if (
    error instanceof ConnectError ||
    errorName(error) === "ConnectError"
  ) {
    const code = connectErrorField(error, "code");
    const status = connectErrorField(error, "status");
    if (
      status === 404 ||
      code === "connector_not_found" ||
      code === "client_not_found"
    ) {
      return { connector: "missing", installation: "unknown" };
    }
  }

  return { connector: "blocked", installation: "unknown" };
}

export function buildAppChannelStages(input: AppChannelProbe): ConnectorStage[] {
  const providerName = input.provider === "slack" ? "Slack" : "Linear";
  const connector = stage(
    "connector",
    input.connector === "verified"
      ? "verified"
      : input.connector === "missing"
        ? "action-required"
        : "blocked",
    input.connector === "verified"
      ? `${providerName} is linked to this server-side Vercel project.`
      : input.connector === "missing"
        ? `No usable ${providerName} connector is linked to this project.`
        : `${providerName} connector access could not be verified from this deployment.`,
    input.connector === "verified"
      ? null
      : input.connector === "missing"
        ? createConnectorAction(input.provider)
        : inspectConnectorAction(providerName),
  );

  const installationState = input.connector !== "verified"
    ? "unknown"
    : input.installation === "verified"
      ? "verified"
      : input.installation === "required"
        ? "action-required"
        : input.installation === "blocked"
          ? "blocked"
          : "unknown";
  const installation = stage(
    "installation",
    installationState,
    installationSummary(input.provider, installationState),
    installationState === "verified" || installationState === "unknown"
      ? null
      : input.connector === "verified"
        ? manageConnectorAction(providerName)
        : createConnectorAction(input.provider),
  );

  const triggerVerified = input.delivery !== null;
  const triggerState = triggerVerified
    ? "verified"
    : input.installation === "verified"
      ? "action-required"
      : "unknown";
  const trigger = stage(
    "trigger",
    triggerState,
    triggerVerified
      ? `A verified ${providerName} event reached Docs Agent at ${formatVerifiedAt(input.delivery!.verifiedAt)}.`
      : triggerSummary(input.provider),
    triggerState === "action-required"
      ? attachTriggerAction(input.provider)
      : null,
  );

  const linearGrantState = triggerVerified
    ? "verified"
    : input.installation === "verified"
      ? "action-required"
      : "unknown";
  const grant = input.provider === "slack"
    ? stage(
        "grant",
        "not-applicable",
        "Slack has no separate grant stage; workspace authorization belongs to app installation and delivery proof belongs to the trigger.",
        null,
      )
    : stage(
        "grant",
        linearGrantState,
        triggerVerified
          ? "A real Agent Session proves the app is assignable or mentionable in Linear."
          : "Linear must grant app:assignable and app:mentionable before an Agent Session can reach Docs Agent.",
        linearGrantState === "action-required"
          ? manageConnectorAction("Linear")
          : null,
      );

  return [connector, installation, trigger, grant].map((value) =>
    connectorStageSchema.parse(value),
  );
}

export function buildGitHubStages(input: {
  status:
    | "ready"
    | "missing-connector"
    | "connector-unavailable"
    | "app-not-installed"
    | "repository-not-granted"
    | "insufficient-permissions";
}): ConnectorStage[] {
  const connectorVerified = ![
    "missing-connector",
    "connector-unavailable",
  ].includes(input.status);
  const installationVerified = [
    "ready",
    "repository-not-granted",
    "insufficient-permissions",
  ].includes(input.status);
  const githubInstallationState = installationVerified
    ? "verified"
    : connectorVerified
      ? "action-required"
      : "unknown";
  const githubGrantState = input.status === "ready"
    ? "verified"
    : installationVerified
      ? "action-required"
      : "unknown";

  return [
    stage(
      "connector",
      connectorVerified
        ? "verified"
        : input.status === "missing-connector"
          ? "action-required"
          : "blocked",
      connectorVerified
        ? "The configured GitHub connector is available server-side."
        : input.status === "missing-connector"
          ? "No usable GitHub connector is available for writeback."
          : "The configured GitHub connector is not available to this deployment.",
      connectorVerified
        ? null
        : input.status === "missing-connector"
          ? createConnectorAction("github")
          : inspectConnectorAction("GitHub"),
    ),
    stage(
      "installation",
      githubInstallationState,
      installationVerified
        ? "GitHub issued an installation-scoped app token."
        : "A GitHub administrator must install or authorize the app; Docs Agent cannot consent on their behalf.",
      githubInstallationState === "action-required"
        ? manageConnectorAction("GitHub")
        : null,
    ),
    stage(
      "trigger",
      "not-applicable",
      "This runtime uses GitHub for outbound writeback, not as an inbound Eve channel.",
      null,
    ),
    stage(
      "grant",
      githubGrantState,
      githubGrantSummary(input.status),
      githubGrantState === "action-required"
        ? manageConnectorAction("GitHub")
        : null,
    ),
  ].map((value) => connectorStageSchema.parse(value));
}

function stage(
  id: z.infer<typeof connectorStageIdSchema>,
  state: ConnectorStageState,
  summary: string,
  action: z.infer<typeof connectorHandoffActionSchema> | null,
): ConnectorStage {
  return { id, label: stageLabels[id], state, summary, action };
}

function createConnectorAction(provider: ConnectorProvider) {
  const withTriggers = provider === "github" ? "" : " --triggers";
  return connectorHandoffActionSchema.parse({
    kind: "terminal",
    label: createConnectorLabel(provider),
    command: `vercel connect create ${provider}${withTriggers}`,
    href: connectDashboardUrl,
    humanRequired: true,
  });
}

function manageConnectorAction(providerNameValue: string) {
  return connectorHandoffActionSchema.parse({
    kind: "browser",
    label: `Open the ${providerNameValue} connector and complete provider consent or admin approval`,
    command: [
      "vercel connect list --format=json",
      "vercel connect open <uid>",
    ].join("\n"),
    href: connectDashboardUrl,
    humanRequired: true,
  });
}

function inspectConnectorAction(providerNameValue: string) {
  return connectorHandoffActionSchema.parse({
    kind: "browser",
    label: `Inspect the ${providerNameValue} connector and restore its project link`,
    command: [
      "vercel connect list --format=json",
      "vercel connect open <uid>",
    ].join("\n"),
    href: connectDashboardUrl,
    humanRequired: true,
  });
}

function attachTriggerAction(provider: AppChannelProvider) {
  return connectorHandoffActionSchema.parse({
    kind: "terminal",
    label: `Attach the ${providerName(provider)} trigger, then send a real test event`,
    command: [
      "vercel connect list --format=json",
      "vercel connect detach <uid> --yes",
      `vercel connect attach <uid> --triggers --trigger-path /eve/v1/${provider} --yes`,
    ].join("\n"),
    href: connectDashboardUrl,
    humanRequired: true,
  });
}

function createConnectorLabel(provider: ConnectorProvider): string {
  if (provider === "slack") {
    return "Create the Slack connector interactively, then configure DOCS_AGENT_SLACK_CONNECTOR with the returned UID";
  }
  if (provider === "linear") {
    return "Create the Linear connector interactively, then configure DOCS_AGENT_LINEAR_CONNECTOR with the returned UID";
  }
  return "Create the GitHub connector interactively, then enter its returned UID in workspace onboarding";
}

function installationSummary(
  provider: AppChannelProvider,
  state: ConnectorStageState,
): string {
  const name = providerName(provider);
  if (state === "verified") {
    return `${name} issued an app-scoped token and passed its provider API check.`;
  }
  if (state === "action-required") {
    return `${name} requires a human to complete provider installation or authorization.`;
  }
  if (state === "blocked") {
    return `${name} issued a token, but the provider API rejected the installation check.`;
  }
  return `${name} installation cannot be checked until the connector is available.`;
}

function triggerSummary(provider: AppChannelProvider): string {
  return provider === "slack"
    ? "No verified Slack app mention or direct message has reached /eve/v1/slack for the current connector."
    : "No verified Linear AgentSessionEvent has reached /eve/v1/linear for the current connector.";
}

function githubGrantSummary(
  status: Parameters<typeof buildGitHubStages>[0]["status"],
): string {
  switch (status) {
    case "ready":
      return "The app can access the configured repository with contents:write and pull_requests:write.";
    case "repository-not-granted":
      return "Grant the app installation access to the configured working documentation repository.";
    case "insufficient-permissions":
      return "Grant contents:write and pull_requests:write to the GitHub App installation.";
    default:
      return "Repository access and write permissions cannot be checked until the app is installed.";
  }
}

function resolveAppChannelConnector(
  provider: AppChannelProvider,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return provider === "slack"
    ? resolveSlackConnector(env)
    : resolveLinearConnector(env);
}

function connectorFingerprint(connector: string): string {
  return createHash("sha256").update(connector).digest("hex");
}

function providerName(provider: ConnectorProvider): string {
  if (provider === "slack") return "Slack";
  if (provider === "linear") return "Linear";
  return "GitHub";
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function connectErrorField(
  error: unknown,
  key: "code" | "status",
): string | number | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return undefined;
  }
  const value = error[key as keyof typeof error];
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function formatVerifiedAt(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}
