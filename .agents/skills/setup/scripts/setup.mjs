import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const envPath = join(repositoryRoot, ".env.local");
const existingEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

run("pnpm", ["install"]);

const databaseUrl = firstValue(
  process.env.PAIGE_DATABASE_URL?.trim(),
  envValue(existingEnv, "PAIGE_DATABASE_URL"),
  process.env.TURSO_DATABASE_URL?.trim(),
  envValue(existingEnv, "TURSO_DATABASE_URL"),
  process.env.DOCS_AGENT_DATABASE_URL?.trim(),
  envValue(existingEnv, "DOCS_AGENT_DATABASE_URL"),
);
const authToken = firstValue(
  process.env.PAIGE_DATABASE_AUTH_TOKEN?.trim(),
  envValue(existingEnv, "PAIGE_DATABASE_AUTH_TOKEN"),
  process.env.TURSO_AUTH_TOKEN?.trim(),
  envValue(existingEnv, "TURSO_AUTH_TOKEN"),
  process.env.DOCS_AGENT_DATABASE_AUTH_TOKEN?.trim(),
  envValue(existingEnv, "DOCS_AGENT_DATABASE_AUTH_TOKEN"),
);
if (!databaseUrl || !authToken) {
  fail(
    "The linked Vercel environment does not contain the Turso URL and auth token.",
  );
}
if (!databaseUrl.startsWith("libsql://")) {
  fail("The coding harness requires the linked Turso libSQL database URL.");
}

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

let nextEnv = upsertEnv(existingEnv, "PAIGE_DATABASE_URL", databaseUrl);
nextEnv = upsertEnv(
  nextEnv,
  "PAIGE_DATABASE_AUTH_TOKEN",
  authToken,
);
writeLocalEnvironment(nextEnv);

const configuredConnector = firstValue(
  process.env.PAIGE_SLACK_CONNECTOR?.trim(),
  envValue(existingEnv, "PAIGE_SLACK_CONNECTOR"),
  process.env.DOCS_AGENT_SLACK_CONNECTOR?.trim(),
  envValue(existingEnv, "DOCS_AGENT_SLACK_CONNECTOR"),
);
const slackConnector = resolveSlackConnector(configuredConnector);
await verifySlackInstallation(slackConnector.uid);

nextEnv = upsertEnv(
  nextEnv,
  "PAIGE_SLACK_CONNECTOR",
  slackConnector.uid,
);
writeLocalEnvironment(nextEnv);

console.log("Local development setup complete.");
console.log(`Slack connector: ${slackConnector.uid}`);
console.log("Slack installation: verified");
console.log("Database: Turso connection verified");

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

  const created = vercelJson([
    "connect",
    "create",
    "slack",
    "--name",
    "Paige",
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
    envValue(existingEnv, "VERCEL_OIDC_TOKEN"),
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

function writeLocalEnvironment(source) {
  writeFileSync(envPath, source, "utf8");
  chmodSync(envPath, 0o600);
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
