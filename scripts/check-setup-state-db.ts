import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { eq } from "drizzle-orm";

import {
  resolveDocsAgentDatabaseConfig,
  withDocsAgentDatabase,
} from "../agent/lib/db/client.js";
import { workspaceSetup } from "../agent/lib/db/schema.js";

assert.throws(
  () => resolveDocsAgentDatabaseConfig({ VERCEL: "1" }),
  /DOCS_AGENT_DATABASE_URL/,
);

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-setup-db-"));
const originalCwd = process.cwd();

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "setup.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

process.chdir(tempRoot);
await mkdir(join(tempRoot, ".docs-agent"));
await writeFile(
  join(tempRoot, ".docs-agent", "config.json"),
  `${JSON.stringify({
    version: 1,
    workingRepositoryInput: {
      workingDocumentationRepository: {
        source: {
          type: "github-url",
          url: "https://github.com/example/obsolete-docs.git",
        },
      },
    },
    githubWriteback: { connector: "github/obsolete" },
  })}\n`,
);

const {
  getSetupStatus,
  readSetupState,
  saveGitHubWritebackSetup,
  saveWorkingRepositorySetup,
} = await import("../agent/lib/setup-state.js");

const repositoryInput = {
  workingDocumentationRepository: {
    source: {
      type: "github-url" as const,
      url: "https://github.com/peelar/saleor-docs.git",
    },
  },
  watchedRepositories: [
    {
      id: "saleor-core",
      name: "Saleor Core",
      description: "Saleor source repository used as read-only release evidence.",
      source: {
        type: "github-url" as const,
        url: "https://github.com/saleor/saleor.git",
      },
      sandboxPath: "/workspace/watched/saleor-core",
      provenanceLabel: "watched-repository:saleor/saleor",
    },
  ],
};

assert.equal(await readSetupState(), null);

const firstRunStatus = await getSetupStatus();
assert.equal(firstRunStatus.docsMaintenanceReady, false);
assert.equal(firstRunStatus.setupMode, true);
assert.equal(firstRunStatus.issues.some((issue) => issue.code === "setup-state-missing"), true);

await saveWorkingRepositorySetup(repositoryInput);
await saveGitHubWritebackSetup({ connector: "github/docs-agent" });

const savedStatus = await getSetupStatus();
assert.equal(savedStatus.docsMaintenanceReady, true);
assert.equal(savedStatus.githubWriteback.connectorConfigured, true);
assert.equal(savedStatus.watchedRepositories.length, 1);
assert.match(savedStatus.statePath, /setup\.sqlite$/);

const savedState = await readSetupState();
assert.equal(
  savedState?.workingRepositoryInput?.workingDocumentationRepository.source.url,
  "https://github.com/peelar/saleor-docs.git",
);
assert.equal(savedState?.githubWriteback.connector, "github/docs-agent");

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "stale-state.sqlite")}`;
await withDocsAgentDatabase(async (db) => {
  await db.insert(workspaceSetup).values({
    id: "default",
    version: 99,
    githubWriteback: {},
  });
});
await assert.rejects(readSetupState, /version/);

process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "new-writes.sqlite")}`;
await saveWorkingRepositorySetup(repositoryInput);
await saveGitHubWritebackSetup({ connector: "github/new-writes" });
await withDocsAgentDatabase(async (db) => {
  const rows = await db
    .select()
    .from(workspaceSetup)
    .where(eq(workspaceSetup.id, "default"))
    .limit(1);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.githubWriteback?.connector, "github/new-writes");
});

process.chdir(originalCwd);
await rm(tempRoot, { recursive: true, force: true });

console.log("Setup-state database checks passed.");
