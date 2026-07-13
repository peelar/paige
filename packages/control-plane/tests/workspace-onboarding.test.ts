import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { validateWorkingRepositoryAccess } from "../src/repository-validation.ts";
import {
  getSetupStatus,
  readPersistedSetupStatus,
  readSetupAuditEvents,
} from "../src/setup-state.ts";
import {
  buildWorkspaceOnboardingState,
  saveValidatedWorkspaceOnboarding,
  validateWorkspaceOnboarding,
  WorkspaceOnboardingValidationError,
} from "../src/workspace-onboarding.ts";
import { test } from "vitest";

test("workspace onboarding", async () => {
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-onboarding-"));
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;

try {
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "onboarding.sqlite")}`;
  delete process.env.VERCEL;
  await migrateDocsAgentDatabase();

  const input = {
    repositoryUrl: "https://github.com/example/docs.git",
    githubConnector: "github/docs-agent",
    watchedRepositories: [{
      repositoryUrl: "https://github.com/example/product",
      name: "Product source",
      description: "Read-only product evidence",
      importance: "high" as const,
      signals: ["releases", "pull-requests"] as const,
    }],
  };
  const preflightStates: unknown[] = [];
  const readyDependencies = {
    validateRepository: async () => ({
      repositoryUrl: input.repositoryUrl,
      ref: "main",
      status: "ready" as const,
    }),
    preflight: async ({ state }: { state: unknown }) => {
      preflightStates.push(state);
      return { status: "ready" as const, message: "GitHub writeback is ready." };
    },
  };

  const validation = await validateWorkspaceOnboarding(input, readyDependencies);
  assert.equal(validation.readyForPersistence, true);
  assert.equal(validation.input?.ref, "main");
  assert.equal(validation.input?.docsRoot, undefined);
  assert.equal(validation.checks.every(({ status }) => status === "passed"), true);
  assert.equal(preflightStates.length, 1);

  const blockedDependencies = {
    ...readyDependencies,
    validateRepository: async () => {
      throw new Error("GitHub ref was not found: example/docs#missing.");
    },
  };
  const blocked = await validateWorkspaceOnboarding(
    { ...input, ref: "missing" },
    blockedDependencies,
  );
  assert.equal(blocked.readyForPersistence, false);
  assert.match(
    blocked.checks.find(({ id }) => id === "repository")?.message ?? "",
    /ref was not found/i,
  );
  await assert.rejects(
    () => saveValidatedWorkspaceOnboarding({
      setup: { ...input, ref: "missing" },
      actor: { id: "docs-agent:github:42", githubLogin: "operator" },
    }, blockedDependencies),
    WorkspaceOnboardingValidationError,
  );
  assert.equal((await readPersistedSetupStatus()).configured, false);
  assert.deepEqual(await readSetupAuditEvents(), []);

  const saved = await saveValidatedWorkspaceOnboarding({
    setup: input,
    actor: { id: "docs-agent:github:42", githubLogin: "Operator" },
  }, readyDependencies);
  assert.equal(saved.state.workingRepositoryInput?.workingDocumentationRepository.ref, "main");
  assert.equal(saved.state.workingRepositoryInput?.workingDocumentationRepository.docsRoot, undefined);
  const watched = saved.state.workingRepositoryInput?.watchedRepositories[0];
  assert.equal(watched?.accessMode, "sandbox-read");
  assert.deepEqual(watched?.allowedActions, [
    "clone",
    "read",
    "search",
    "inspect-diff",
    "run-readonly-checks",
  ]);
  assert.equal(watched?.provenanceLabel, "watched-repository:example/product");

  const persisted = await readPersistedSetupStatus();
  assert.equal(persisted.state?.workingRepositoryInput?.workingDocumentationRepository.source.url, input.repositoryUrl);
  assert.equal((await getSetupStatus()).docsMaintenanceReady, true);
  const audit = await readSetupAuditEvents();
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.actor.id, "docs-agent:github:42");
  assert.equal(audit[0]?.actor.githubLogin, "operator");
  assert.equal(audit[0]?.action, "workspace-onboarding-saved");
  assert.equal(
    audit[0]?.setupSnapshot.workingRepositoryInput?.watchedRepositories[0]?.accessMode,
    "sandbox-read",
  );

  const state = buildWorkspaceOnboardingState({
    repositoryUrl: input.repositoryUrl,
    ref: "release-1",
    docsRoot: "docs",
    githubConnector: "github/docs-agent",
    watchedRepositories: [],
  });
  const paths: string[] = [];
  await validateWorkingRepositoryAccess({
    repositoryInput: state.workingRepositoryInput!,
    setupState: state,
  }, {
    resolveToken: async () => ({
      token: "test-token",
      expiresAt: Date.now() + 60_000,
      connector: { id: "connector-id", uid: "github/docs-agent", type: "github" },
    }),
    request: async <T>({ path }: { path: string }) => {
      paths.push(path);
      return { ok: true as const, status: 200, body: [] as T };
    },
  });
  assert.deepEqual(paths, [
    "/repos/example/docs",
    "/repos/example/docs/branches/release-1",
    "/repos/example/docs/contents/docs?ref=release-1",
  ]);

  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "unmigrated.sqlite")}`;
  await assert.rejects(readWorkspaceOnboardingState, /database schema is not ready/i);
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Workspace onboarding checks passed.");

async function readWorkspaceOnboardingState() {
  return readPersistedSetupStatus();
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
});
