import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConnectError,
  ConnectorInstallationRequiredError,
  NoValidTokenError,
} from "@vercel/connect";

import {
  buildAppChannelStages,
  buildGitHubStages,
  classifyConnectSetupError,
  readConnectorDeliveryVerification,
  recordConnectorDeliveryVerification,
} from "../src/connector-handoffs.ts";
import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { test } from "vitest";

test("connector handoffs", async () => {
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-connector-handoffs-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalSlackConnector = process.env.DOCS_AGENT_SLACK_CONNECTOR;
const originalVercel = process.env.VERCEL;

delete process.env.VERCEL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "handoffs.sqlite")}`;
process.env.DOCS_AGENT_SLACK_CONNECTOR = "slack/private-connector-id";

try {
  await migrateDocsAgentDatabase();
  assert.equal(
    await readConnectorDeliveryVerification({ provider: "slack" }),
    null,
  );

  const recorded = await recordConnectorDeliveryVerification({
    provider: "slack",
    evidence: "slack-verified-webhook",
    verifiedAt: new Date("2026-07-11T12:30:00.000Z"),
  });
  assert.deepEqual(
    await readConnectorDeliveryVerification({ provider: "slack" }),
    recorded,
  );

  process.env.DOCS_AGENT_SLACK_CONNECTOR = "slack/replaced-connector-id";
  assert.equal(
    await readConnectorDeliveryVerification({ provider: "slack" }),
    null,
    "delivery proof must not carry across connector changes",
  );

  assert.deepEqual(
    classifyConnectSetupError(
      new ConnectorInstallationRequiredError("Install the app."),
    ),
    { connector: "missing", installation: "unknown" },
  );
  assert.deepEqual(
    classifyConnectSetupError(
      new NoValidTokenError("Install the provider app."),
    ),
    { connector: "verified", installation: "required" },
  );
  assert.deepEqual(
    classifyConnectSetupError(
      new ConnectError("Connector not found.", { status: 404 }),
    ),
    { connector: "missing", installation: "unknown" },
  );
  assert.deepEqual(
    classifyConnectSetupError(new Error("OIDC unavailable.")),
    { connector: "blocked", installation: "unknown" },
  );

  const slack = buildAppChannelStages({
    provider: "slack",
    connector: "verified",
    installation: "verified",
    delivery: recorded,
  });
  assert.deepEqual(
    slack.map(({ id, state }) => [id, state]),
    [
      ["connector", "verified"],
      ["installation", "verified"],
      ["trigger", "verified"],
      ["grant", "not-applicable"],
    ],
  );

  const linear = buildAppChannelStages({
    provider: "linear",
    connector: "verified",
    installation: "verified",
    delivery: null,
  });
  assert.equal(linear.find(({ id }) => id === "trigger")?.state, "action-required");
  assert.equal(linear.find(({ id }) => id === "grant")?.state, "action-required");
  assert.match(
    linear.find(({ id }) => id === "trigger")?.action?.command ?? "",
    /--trigger-path \/eve\/v1\/linear/,
  );

  const missingSlack = buildAppChannelStages({
    provider: "slack",
    connector: "missing",
    installation: "unknown",
    delivery: null,
  });
  assert.equal(
    missingSlack.find(({ id }) => id === "connector")?.action?.command,
    "vercel connect create slack --triggers --icon ./assets/paige/paige-magpie-master.png",
  );
  assert.equal(
    missingSlack.find(({ id }) => id === "installation")?.action,
    null,
    "dependent stages stay explicit without repeating an unusable action",
  );

  const blockedSlack = buildAppChannelStages({
    provider: "slack",
    connector: "blocked",
    installation: "unknown",
    delivery: null,
  });
  assert.match(
    blockedSlack.find(({ id }) => id === "connector")?.action?.command ?? "",
    /vercel connect list --format=json/,
  );
  assert.doesNotMatch(
    blockedSlack.find(({ id }) => id === "connector")?.action?.command ?? "",
    /connect create/,
  );

  const github = buildGitHubStages({ status: "repository-not-granted" });
  assert.equal(github.find(({ id }) => id === "connector")?.state, "verified");
  assert.equal(github.find(({ id }) => id === "installation")?.state, "verified");
  assert.equal(github.find(({ id }) => id === "trigger")?.state, "not-applicable");
  assert.equal(github.find(({ id }) => id === "grant")?.state, "action-required");

  const browserContract = JSON.stringify({ slack, linear, github });
  assert.doesNotMatch(browserContract, /private-connector-id|replaced-connector-id/);
  assert.doesNotMatch(browserContract, /xox[baprs]-|lin_api_|github_pat_/i);
  assert.match(browserContract, /Human|humanRequired|<uid>/);
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("DOCS_AGENT_SLACK_CONNECTOR", originalSlackConnector);
  restoreEnvironment("VERCEL", originalVercel);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Connector handoff checks passed.");

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
});
