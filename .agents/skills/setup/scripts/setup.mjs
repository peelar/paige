import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { brandResolver } from "./brand-resolver.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
if (process.argv.includes("--help")) {
  console.log("Usage: pnpm exec node .agents/skills/setup/scripts/setup.mjs");
  process.exit(0);
}

const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
if (packageJson.name !== "paige-workspace") {
  fail("Run this provisioner from the Paige repository.");
}
if (!existsSync(join(repositoryRoot, ".vercel", "project.json"))) {
  fail("Link this checkout to its Vercel project before running setup.");
}

const pulledEnvPath = join(repositoryRoot, ".env.setup.local");
const legacyRootEnvPath = join(repositoryRoot, ".env.local");
const agentEnvPath = join(repositoryRoot, "apps", "agent", ".env.local");
const webEnvPath = join(repositoryRoot, "apps", "web", ".env.local");

run("pnpm", ["install"]);
run("pnpm", [
  "dlx",
  "vercel",
  "env",
  "pull",
  pulledEnvPath,
  "--environment=production",
  "--yes",
]);
const pulledEnv = readFileSync(pulledEnvPath, "utf8");
unlinkSync(pulledEnvPath);

const databaseCredentials = [
  {
    url: firstValue(
      process.env.PAIGE_DATABASE_URL?.trim(),
      envValue(pulledEnv, "PAIGE_DATABASE_URL"),
    ),
    authToken: firstValue(
      process.env.PAIGE_DATABASE_AUTH_TOKEN?.trim(),
      envValue(pulledEnv, "PAIGE_DATABASE_AUTH_TOKEN"),
    ),
  },
  {
    url: firstValue(
      process.env.TURSO_DATABASE_URL?.trim(),
      envValue(pulledEnv, "TURSO_DATABASE_URL"),
    ),
    authToken: firstValue(
      process.env.TURSO_AUTH_TOKEN?.trim(),
      envValue(pulledEnv, "TURSO_AUTH_TOKEN"),
    ),
  },
  {
    url: firstValue(
      process.env.DOCS_AGENT_DATABASE_URL?.trim(),
      envValue(pulledEnv, "DOCS_AGENT_DATABASE_URL"),
    ),
    authToken: firstValue(
      process.env.DOCS_AGENT_DATABASE_AUTH_TOKEN?.trim(),
      envValue(pulledEnv, "DOCS_AGENT_DATABASE_AUTH_TOKEN"),
    ),
  },
].find(({ url, authToken }) =>
  url?.startsWith("libsql://") && authToken !== undefined
);
const slackSigningSecret = firstValue(
  process.env.PAIGE_SLACK_SIGNING_SECRET?.trim(),
  envValue(pulledEnv, "PAIGE_SLACK_SIGNING_SECRET"),
);
const vercelOidcToken = firstValue(
  process.env.VERCEL_OIDC_TOKEN?.trim(),
  envValue(pulledEnv, "VERCEL_OIDC_TOKEN"),
);
if (!databaseCredentials) {
  fail(
    "The linked Vercel environment does not contain the Turso URL and auth token.",
  );
}
const { url: databaseUrl, authToken } = databaseCredentials;
if (!slackSigningSecret) {
  fail("The linked Vercel environment is missing PAIGE_SLACK_SIGNING_SECRET.");
}
if (!vercelOidcToken) {
  fail("The pulled Vercel OIDC token is missing.");
}

const productionAgentUrl = resolveProductionAgentUrl(
  firstValue(
    process.env.PAIGE_PRODUCTION_AGENT_URL?.trim(),
    envValue(pulledEnv, "PAIGE_PRODUCTION_AGENT_URL"),
  ),
);
await verifyProductionAgent(productionAgentUrl, vercelOidcToken);

const agentRequire = createRequire(
  join(repositoryRoot, "apps", "agent", "package.json"),
);
const { createClient } = agentRequire("@libsql/client");
const database = createClient({ url: databaseUrl, authToken });
try {
  await database.execute("SELECT 1");
} finally {
  database.close();
}

let agentEnv = localEnvironment([
  ["PAIGE_DATABASE_URL", databaseUrl],
  ["PAIGE_DATABASE_AUTH_TOKEN", authToken],
  ["AI_GATEWAY_API_KEY", envValue(pulledEnv, "AI_GATEWAY_API_KEY")],
  ["EVE_GATEWAY_MODEL", envValue(pulledEnv, "EVE_GATEWAY_MODEL")],
  ["EVE_SANDBOX_BACKEND", envValue(pulledEnv, "EVE_SANDBOX_BACKEND")],
  ["PAIGE_GITHUB_CONNECTOR", envValue(pulledEnv, "PAIGE_GITHUB_CONNECTOR")],
  ["PAIGE_SLACK_SIGNING_SECRET", slackSigningSecret],
  ["VERCEL_OIDC_TOKEN", vercelOidcToken],
]);
writeLocalEnvironment(agentEnvPath, agentEnv);
writeLocalEnvironment(webEnvPath, localEnvironment([
  ["PAIGE_DATABASE_URL", databaseUrl],
  ["PAIGE_DATABASE_AUTH_TOKEN", authToken],
  ["PAIGE_PRODUCTION_AGENT_URL", productionAgentUrl],
  ["VERCEL_OIDC_TOKEN", vercelOidcToken],
]));
if (existsSync(legacyRootEnvPath)) unlinkSync(legacyRootEnvPath);

// Database structure is applied as an explicit setup step. Application
// requests only verify the schema and never create or alter tables.
run("pnpm", ["db:migrate"]);

const configuredConnector = firstValue(
  process.env.PAIGE_SLACK_CONNECTOR?.trim(),
  envValue(pulledEnv, "PAIGE_SLACK_CONNECTOR"),
  process.env.DOCS_AGENT_SLACK_CONNECTOR?.trim(),
  envValue(pulledEnv, "DOCS_AGENT_SLACK_CONNECTOR"),
);
const slackConnector = resolveSlackConnector(configuredConnector);
await verifySlackInstallation(slackConnector.uid);

agentEnv = upsertEnv(
  agentEnv,
  "PAIGE_SLACK_CONNECTOR",
  slackConnector.uid,
);
writeLocalEnvironment(agentEnvPath, agentEnv);

console.log("Local development setup complete.");
console.log(`Slack connector: ${slackConnector.uid}`);
console.log("Slack installation: verified");
console.log("Database: Turso connection verified");
console.log("Database migrations: applied");
console.log("Production agent: verified");

function resolveProductionAgentUrl(configuredUrl) {
  if (configuredUrl) return normalizedHttpsOrigin(configuredUrl);

  const project = JSON.parse(
    readFileSync(join(repositoryRoot, ".vercel", "project.json"), "utf8"),
  );
  const remote = vercelJson(["api", `/v9/projects/${project.projectId}`]);
  const production = remote.targets?.production;
  const aliases = Array.isArray(production?.alias) ? production.alias : [];
  const automaticAliases = new Set(
    Array.isArray(production?.automaticAliases)
      ? production.automaticAliases
      : [],
  );
  const publicAlias = aliases.find((alias) => !automaticAliases.has(alias));
  if (!publicAlias) {
    fail(
      "The linked Vercel project needs a public production alias for the operator app.",
    );
  }
  return normalizedHttpsOrigin(`https://${publicAlias}`);
}

async function verifyProductionAgent(origin, oidcToken) {
  let response;
  try {
    response = await fetch(new URL("/eve/v1/info", origin), {
      headers: { authorization: `Bearer ${oidcToken}` },
      redirect: "manual",
    });
  } catch {
    fail("The production Paige agent could not be reached.");
  }
  if (!response.ok) {
    fail(
      `The production Paige agent rejected the operator connection (${response.status}).`,
    );
  }
}

function normalizedHttpsOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("PAIGE_PRODUCTION_AGENT_URL must be a valid HTTPS origin.");
  }
  if (url.protocol !== "https:" || url.pathname !== "/") {
    fail("PAIGE_PRODUCTION_AGENT_URL must be a valid HTTPS origin.");
  }
  return url.origin;
}

function resolveSlackConnector(preferredUid) {
  const linked = listSlackConnectors(false);
  const linkedMatch = selectConnector(linked, preferredUid);
  if (linkedMatch) return linkedMatch;
  if (linked.length > 1) failMultipleConnectors(linked);

  const available = listSlackConnectors(true);
  const availableMatch = selectConnector(available, preferredUid);
  if (availableMatch) {
    attachSlackConnector(availableMatch.uid);
    return availableMatch;
  }
  if (available.length > 1) failMultipleConnectors(available);

  const brand = brandResolver(repositoryRoot);
  const created = vercelJson([
    "connect",
    "create",
    "slack",
    "--name",
    brand.name,
    "--icon",
    brand.icon,
    "--triggers",
    "--format=json",
  ]);
  const connector = created.connector ?? created;
  if (!isConnector(connector)) {
    fail("Vercel Connect did not return the created Slack connector.");
  }
  // Creation uses Connect's default webhook path. Eve owns a different route.
  vercelJson([
    "connect",
    "detach",
    connector.uid,
    "--yes",
    "--format=json",
  ]);
  attachSlackConnector(connector.uid);
  return connector;
}

function listSlackConnectors(allProjects) {
  const args = [
    "connect",
    "list",
    "--type",
    "slack",
    "--format=json",
  ];
  if (allProjects) args.push("--all-projects");
  const result = vercelJson(args);
  return Array.isArray(result.connectors)
    ? result.connectors.filter(isConnector)
    : [];
}

function selectConnector(connectors, preferredUid) {
  if (preferredUid) {
    const preferred = connectors.find(({ uid }) => uid === preferredUid);
    if (preferred) return preferred;
  }
  const paige = connectors.find(({ uid }) => uid === "slack/paige");
  if (paige) return paige;
  return connectors.length === 1 ? connectors[0] : undefined;
}

function attachSlackConnector(uid) {
  vercelJson([
    "connect",
    "attach",
    uid,
    "--environment",
    "production",
    "--triggers",
    "--trigger-path",
    "/eve/v1/slack",
    "--yes",
    "--format=json",
  ]);
}

async function verifySlackInstallation(connectorUid) {
  const vercelToken = firstValue(
    process.env.VERCEL_OIDC_TOKEN?.trim(),
    envValue(agentEnv, "VERCEL_OIDC_TOKEN"),
  );
  if (!vercelToken) fail("The pulled Vercel OIDC token is missing.");

  const moduleUrl = pathToFileURL(join(
    repositoryRoot,
    "apps",
    "agent",
    "node_modules",
    "@vercel",
    "connect",
    "dist",
    "index.js",
  ));
  const { getTokenResponse } = await import(moduleUrl.href);
  let connectToken;
  try {
    connectToken = await getTokenResponse(
      connectorUid,
      { subject: { type: "app" } },
      { vercelToken, forceRefresh: true },
    );
  } catch {
    openConnectorInstallation(connectorUid);
  }

  const response = await fetch("https://slack.com/api/auth.test", {
    headers: { authorization: `Bearer ${connectToken.token}` },
  });
  const result = await response.json();
  if (!result.ok || typeof result.team_id !== "string") {
    openConnectorInstallation(connectorUid);
  }
  return result.team_id;
}

function openConnectorInstallation(uid) {
  run("pnpm", ["dlx", "vercel", "connect", "open", uid]);
  fail(
    "Complete the Slack installation in Vercel Connect, then rerun setup.",
  );
}

function failMultipleConnectors(connectors) {
  fail(
    `More than one Slack connector is available: ${connectors
      .map(({ uid }) => uid)
      .join(", ")}. Attach the intended connector to this Vercel project first.`,
  );
}

function isConnector(value) {
  return typeof value === "object" &&
    value !== null &&
    "uid" in value &&
    typeof value.uid === "string";
}

function envValue(source, name) {
  const match = source.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) return undefined;
  const value = match[1]?.trim();
  if (!value) return undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value.length > 0);
}

function localEnvironment(entries) {
  return entries
    .filter((entry) => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${serializeEnvValue(value)}`)
    .join("\n") + "\n";
}

function upsertEnv(source, name, value) {
  const line = `${name}=${serializeEnvValue(value)}`;
  const expression = new RegExp(`^${name}=.*$`, "m");
  if (expression.test(source)) return source.replace(expression, line);
  const prefix = source.length === 0 || source.endsWith("\n")
    ? source
    : `${source}\n`;
  return `${prefix}${line}\n`;
}

function serializeEnvValue(value) {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}

function writeLocalEnvironment(path, source) {
  writeFileSync(path, source, "utf8");
  chmodSync(path, 0o600);
}

function vercelJson(args) {
  const result = spawnSync("pnpm", ["dlx", "vercel", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(`Vercel CLI exited with status ${result.status}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("Vercel CLI returned an invalid response.");
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} exited with status ${result.status}.`);
}

function fail(message) {
  console.error(`Setup failed: ${message}`);
  process.exit(1);
}
