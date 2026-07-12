import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDocsSignalInputSchema,
  createDocsSignal,
  getDocsSignal,
  listDocsSignals,
} from "../src/docs-signals.js";
import {
  migrateDocsAgentDatabase,
  resolveDocsAgentDatabaseConfig,
} from "../src/db/client.js";
import {
  getSetupStatus,
  readPersistedSetupStatus,
  saveWorkingRepositorySetup,
} from "../src/setup-state.js";
import { repositoryInputSchema } from "../src/repository-contract.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const agentRoot = join(repositoryRoot, "apps", "agent");
const webRoot = join(repositoryRoot, "apps", "web");

const agentDatabase = resolveDocsAgentDatabaseConfig({}, agentRoot);
const webDatabase = resolveDocsAgentDatabaseConfig({}, webRoot);
const productionWebDatabase = resolveDocsAgentDatabaseConfig(
  { NODE_ENV: "production" },
  webRoot,
);
assert.equal(agentDatabase.localFilePath, webDatabase.localFilePath);
assert.equal(agentDatabase.localFilePath, productionWebDatabase.localFilePath);
assert.equal(
  agentDatabase.localFilePath,
  join(repositoryRoot, ".docs-agent", "docs-agent.sqlite"),
);

const configuredAgentDatabase = resolveDocsAgentDatabaseConfig(
  { DOCS_AGENT_DATABASE_URL: "file:.docs-agent/configured.sqlite" },
  agentRoot,
);
const configuredWebDatabase = resolveDocsAgentDatabaseConfig(
  { DOCS_AGENT_DATABASE_URL: "file:.docs-agent/configured.sqlite" },
  webRoot,
);
assert.equal(configuredAgentDatabase.localFilePath, configuredWebDatabase.localFilePath);

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-control-plane-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;

try {
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "control-plane.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  await migrateDocsAgentDatabase();

  const emptySetup = await readPersistedSetupStatus();
  assert.equal(emptySetup.configured, false);
  assert.equal(emptySetup.state, null);
  const emptySetupStatus = await getSetupStatus();
  assert.equal(emptySetupStatus.docsMaintenanceReady, false);
  assert.equal(
    emptySetupStatus.issues.some((issue) => issue.code === "setup-state-missing"),
    true,
  );

  await saveWorkingRepositorySetup(repositoryInputSchema.parse({
    workingDocumentationRepository: {
      source: {
        type: "github-url",
        url: "https://github.com/example/docs.git",
      },
    },
  }));
  const configuredSetup = await readPersistedSetupStatus();
  assert.equal(configuredSetup.configured, true);
  assert.equal(
    configuredSetup.state?.workingRepositoryInput?.workingDocumentationRepository.ref,
    "main",
  );
  const configuredSetupStatus = await getSetupStatus();
  assert.equal(configuredSetupStatus.docsMaintenanceReady, true);

  const created = await createDocsSignal(createDocsSignalInputSchema.parse({
    source: { kind: "manual-scenario", providerId: "control-plane-boundary" },
    sourceSummary: "Control-plane read service verification.",
  }));
  const listed = await listDocsSignals();
  const detail = await getDocsSignal({ id: created.signal.id });
  assert.equal(listed.signals[0]?.id, created.signal.id);
  assert.equal(detail.sourceSummary, "Control-plane read service verification.");

  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "unmigrated.sqlite")}`;
  await assert.rejects(readPersistedSetupStatus, /database schema is not ready/i);
  await assert.rejects(() => listDocsSignals(), /database schema is not ready/i);

  const webBoundary = await readFile(
    join(webRoot, "lib", "control-plane.ts"),
    "utf8",
  );
  assert.match(webBoundary, /import "server-only"/);
  assert.equal(webBoundary.includes("/testing"), false);
  assert.equal(webBoundary.includes("db/client"), false);
  assert.equal(webBoundary.includes("db/schema"), false);

  const packageManifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as { exports?: Record<string, unknown> };
  assert.equal(packageManifest.exports?.["./agent"], "./dist/agent.js");
  assert.equal(packageManifest.exports?.["./testing"], "./dist/testing.js");

  const agentMemoryShim = await readFile(
    join(agentRoot, "agent", "lib", "workspace-memory.ts"),
    "utf8",
  );
  assert.match(agentMemoryShim, /@docs-agent\/control-plane\/agent/);
  assert.equal(agentMemoryShim.includes("db/client"), false);
  assert.equal(agentMemoryShim.includes("db/schema"), false);

  const publicEntry = await readFile(join(packageRoot, "src", "index.ts"), "utf8");
  assert.match(publicEntry, /import "server-only"/);
  assert.equal(publicEntry.includes("db/client"), false);
  assert.equal(publicEntry.includes("db/schema"), false);
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  restoreEnvironment("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Control-plane package boundary checks passed.");

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
