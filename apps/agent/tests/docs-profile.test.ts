import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "eve/tools";
import { migrateDocsAgentDatabase } from "@docs-agent/control-plane/testing";
import { ensureDocsProfile, loadTaskExamples } from "../agent/lib/docs-profile";
import type { ResolvedWorkingDocumentationRepository } from "../agent/lib/repository-contract";
import { test } from "vitest";

test("docs profile", async () => {
const root = await mkdtemp(join(tmpdir(), "agent-docs-profile-"));
const previous = process.env.DOCS_AGENT_DATABASE_URL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "profile.sqlite")}`;

const files = new Map([
  ["/workspace/working-docs/AGENTS.md", "Prefer sentence case headings. Do not use future tense."],
  ["/workspace/working-docs/package.json", JSON.stringify({ scripts: { build: "docusaurus build", lint: "eslint ." } })],
  ["/workspace/working-docs/docs/guides/example.mdx", "# Build an app\n\nUse the <GraphQLExample> component for developer examples."],
  ["/workspace/working-docs/docs/guides/nearby.mdx", "# Nearby pattern\n\nLead with the reader outcome."],
]);
const sandbox = {
  async run() { return { exitCode: 0, stdout: "AGENTS.md\npackage.json\ndocs/guides/example.mdx\ndocs/guides/nearby.mdx\n", stderr: "" }; },
  async readTextFile({ path }: { path: string }) { return files.get(path) ?? null; },
};
const ctx = { getSandbox: async () => sandbox, abortSignal: new AbortController().signal } as unknown as ToolContext;
const repository: ResolvedWorkingDocumentationRepository = {
  source: { type: "github-url", url: "https://github.com/example/docs.git" }, ref: "main", docsRoot: "docs", sandboxPath: "/workspace/working-docs", accessMode: "sandbox-write", allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"], provenanceLabel: "working-documentation-repository",
};

try {
  await migrateDocsAgentDatabase();
  const materialization = { repositoryUrl: repository.source.url, requestedRef: "main", resolvedCommit: "abc123", docsRoot: "docs", sandboxPath: repository.sandboxPath, status: "materialized" as const };
  const built = await ensureDocsProfile({ ctx, repository, materialization });
  assert.equal(built.reused, false);
  assert.equal(built.profile.styleRules.some(({ value }) => value.includes("sentence case")), true);
  assert.equal(built.profile.validation.some(({ value }) => value.includes("docusaurus build")), true);
  assert.equal((await ensureDocsProfile({ ctx, repository, materialization })).reused, true);
  files.set("/workspace/working-docs/AGENTS.md", "Prefer sentence case headings. Avoid passive voice.");
  assert.equal((await ensureDocsProfile({ ctx, repository, materialization })).reused, false);
  assert.equal((await ensureDocsProfile({ ctx, repository, materialization: { ...materialization, resolvedCommit: "def456" } })).reused, false);
  assert.equal((await ensureDocsProfile({ ctx, repository, materialization: { ...materialization, resolvedCommit: "def456" }, refreshReason: "contradiction" })).reused, false);
  const examples = await loadTaskExamples({ ctx, repository, paths: ["docs/guides/nearby.mdx", "../secret"] });
  assert.deepEqual(examples.map(({ path }) => path), ["docs/guides/nearby.mdx"]);
  assert.match(examples[0]!.excerpt, /reader outcome/);
  const emptyCtx = { getSandbox: async () => ({ ...sandbox, run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) }), abortSignal: new AbortController().signal } as unknown as ToolContext;
  await assert.rejects(ensureDocsProfile({ ctx: emptyCtx, repository, materialization }), /found no instruction, configuration, or representative documentation files/);
} finally {
  if (previous === undefined) delete process.env.DOCS_AGENT_DATABASE_URL; else process.env.DOCS_AGENT_DATABASE_URL = previous;
  await rm(root, { recursive: true, force: true });
}
console.log("Agent docs profile behavior checks passed.");
});
