import { createHash } from "node:crypto";

import type { ToolContext } from "eve/tools";
import { z } from "zod";

import type {
  ResolvedWorkingDocumentationRepository,
  WorkingDocumentationRepository,
} from "./repository-contract.js";
import {
  joinSandboxPath,
  normalizeRepositoryUrl,
  quoteShellArgument as sh,
  recordRepositoryAction,
  RepositoryPolicyError,
  summarizeCommandFailure,
  type RepositoryActionRecord,
} from "./repository-materialization.js";
import type {
  RepositoryCheckName,
  RepositoryCheckResult,
} from "./repository-workflow-contract.js";

const installCacheMarkerSchema = z.object({
  version: z.literal(1),
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  lockfileHash: z.string(),
  command: z.string(),
  status: z.literal("passed"),
});

export async function readRepositoryFile(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  path: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertActionAllowed(repository, "read");
  const absolutePath = resolveRepositoryPath(repository, path);
  const sandbox = await ctx.getSandbox();
  const content = await sandbox.readTextFile({ path: absolutePath, abortSignal: ctx.abortSignal });

  if (content === null) {
    const reason = `File does not exist: ${path}`;
    actionProvenance.push(recordAction(repository, "read", "failure", { target: path, reason }));
    throw new Error(reason);
  }

  actionProvenance.push(recordAction(repository, "read", "success", { target: path }));
  return content;
}

export async function searchRepository(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  query: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertActionAllowed(repository, "search");
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: `rg -n ${sh(query)} ${sh(repository.sandboxPath)}`,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode > 1) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(
      recordAction(repository, "search", "failure", { target: query, reason }),
    );
    throw new Error(`Search failed: ${reason}`);
  }

  actionProvenance.push(recordAction(repository, "search", "success", { target: query }));
  return truncate(result.stdout, 12_000);
}

export async function replaceRepositoryText(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  path: string,
  expectedText: string,
  replacementText: string,
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  assertActionAllowed(repository, "patch");
  const existing = await readRepositoryFile(ctx, repository, path, actionProvenance);

  if (!existing.includes(expectedText)) {
    const reason = `Expected text was not found in ${path}`;
    actionProvenance.push(
      recordAction(repository, "patch", "failure", { target: path, reason }),
    );
    throw new Error(reason);
  }

  const next = existing.replace(expectedText, replacementText);
  const sandbox = await ctx.getSandbox();
  await sandbox.writeTextFile({
    path: resolveRepositoryPath(repository, path),
    content: next,
    abortSignal: ctx.abortSignal,
  });

  actionProvenance.push(recordAction(repository, "patch", "success", { target: path }));
}

export async function runRepositoryCheck(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  name: RepositoryCheckName,
  actionProvenance: RepositoryActionRecord[],
): Promise<RepositoryCheckResult> {
  assertActionAllowed(repository, "run-checks");
  if (name === "install") {
    return runInstallRepositoryCheck(ctx, repository, actionProvenance);
  }

  return runRepositoryCommandCheck(ctx, repository, name, actionProvenance);
}

export async function exportRepositoryDiff(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<string> {
  assertActionAllowed(repository, "export-diff");
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: "git diff --no-ext-diff --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(recordAction(repository, "export-diff", "failure", { reason }));
    throw new Error(`Diff export failed: ${reason}`);
  }

  actionProvenance.push(recordAction(repository, "export-diff", "success"));
  return result.stdout;
}

export async function listChangedFiles(
  ctx: ToolContext,
  repository: ResolvedWorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<string[]> {
  assertActionAllowed(repository, "export-diff");
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: "git diff --name-only --",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (result.exitCode !== 0) {
    const reason = summarizeCommandFailure(result);
    actionProvenance.push(recordAction(repository, "export-diff", "failure", { reason }));
    throw new Error(`Changed-file export failed: ${reason}`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runInstallRepositoryCheck(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  actionProvenance: RepositoryActionRecord[],
): Promise<RepositoryCheckResult> {
  const command = commandForCheck("install");
  const sandbox = await ctx.getSandbox();
  const lockfileHash = await readLockfileHash(ctx, repository);
  const marker = await readInstallCacheMarker(ctx, repository);
  const nodeModules = await sandbox.run({
    command: "test -d node_modules",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  if (
    lockfileHash !== null &&
    nodeModules.exitCode === 0 &&
    marker !== null &&
    marker.repositoryUrl === repository.source.url &&
    marker.requestedRef === repository.ref &&
    marker.lockfileHash === lockfileHash &&
    marker.command === command &&
    marker.status === "passed"
  ) {
    const corepack = await sandbox.run({
      command: "corepack enable",
      workingDirectory: repository.sandboxPath,
      abortSignal: ctx.abortSignal,
    });

    const check = {
      name: "install" as const,
      command: `${command} (cached)`,
      exitCode: corepack.exitCode,
      status: corepack.exitCode === 0 ? ("passed" as const) : ("failed" as const),
      stdout:
        corepack.exitCode === 0
          ? `Reused cached install for pnpm-lock.yaml ${lockfileHash}.\n`
          : truncate(corepack.stdout, 4_000),
      stderr: truncate(corepack.stderr, 4_000),
    };

    actionProvenance.push(
      recordAction(
        repository,
        "run-checks",
        check.status === "passed" ? "success" : "failure",
        {
          commandCategory: "install",
          reason: check.status === "passed" ? undefined : summarizeCommandFailure(corepack),
        },
      ),
    );

    return check;
  }

  const check = await runRepositoryCommandCheck(ctx, repository, "install", actionProvenance);
  if (check.status === "passed" && lockfileHash !== null) {
    await writeInstallCacheMarker(ctx, repository, lockfileHash, command);
  }

  return check;
}

async function runRepositoryCommandCheck(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  name: RepositoryCheckName,
  actionProvenance: RepositoryActionRecord[],
): Promise<RepositoryCheckResult> {
  const sandbox = await ctx.getSandbox();
  const command = commandForCheck(name);
  const result = await sandbox.run({
    command,
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  const check = {
    name,
    command,
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? ("passed" as const) : ("failed" as const),
    stdout: truncate(result.stdout, 4_000),
    stderr: truncate(result.stderr, 4_000),
  };

  actionProvenance.push(
    recordAction(repository, "run-checks", result.exitCode === 0 ? "success" : "failure", {
      commandCategory: name,
      reason: result.exitCode === 0 ? undefined : summarizeCommandFailure(result),
    }),
  );

  return check;
}

function assertActionAllowed(
  repository: WorkingDocumentationRepository,
  action: WorkingDocumentationRepository["allowedActions"][number],
): void {
  if (!repository.allowedActions.includes(action)) {
    throw new RepositoryPolicyError(`Repository action is not allowed: ${action}`);
  }
}

function resolveRepositoryPath(repository: WorkingDocumentationRepository, path: string): string {
  if (path.trim() === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new RepositoryPolicyError(`Use a repository-relative path: ${path}`);
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.includes("..")) {
    throw new RepositoryPolicyError(`Path cannot escape the working repository: ${path}`);
  }

  return joinSandboxPath(repository.sandboxPath, parts.join("/"));
}

async function readLockfileHash(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<string | null> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command:
      "node -e \"const { createHash } = require('node:crypto'); const { readFileSync } = require('node:fs'); process.stdout.write(createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'));\"",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });

  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function readInstallCacheMarker(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
): Promise<z.infer<typeof installCacheMarkerSchema> | null> {
  const sandbox = await ctx.getSandbox();
  const content = await sandbox.readTextFile({
    path: installCacheMarkerPath(repository),
    abortSignal: ctx.abortSignal,
  });

  if (content === null) return null;

  try {
    const parsed = installCacheMarkerSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeInstallCacheMarker(
  ctx: ToolContext,
  repository: WorkingDocumentationRepository,
  lockfileHash: string,
  command: string,
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  await sandbox.run({
    command: `mkdir -p ${sh(installCacheDirectory())}`,
    abortSignal: ctx.abortSignal,
  });
  await sandbox.writeTextFile({
    path: installCacheMarkerPath(repository),
    content: `${JSON.stringify(
      {
        version: 1,
        repositoryUrl: repository.source.url,
        requestedRef: repository.ref,
        lockfileHash,
        command,
        status: "passed",
      },
      null,
      2,
    )}\n`,
    abortSignal: ctx.abortSignal,
  });
}

function installCacheDirectory(): string {
  return "/workspace/.docs-agent-cache/install";
}

function installCacheMarkerPath(repository: WorkingDocumentationRepository): string {
  return `${installCacheDirectory()}/${hashText(
    [normalizeRepositoryUrl(repository.source.url), repository.ref, repository.sandboxPath].join(
      "\n",
    ),
  )}.json`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandForCheck(name: RepositoryCheckName): string {
  switch (name) {
    case "install":
      return "corepack enable && pnpm install --frozen-lockfile";
    case "build":
      return "pnpm build";
    case "diff-check":
      return "git diff --check";
    case "diff-quiet":
      return "git diff --quiet";
    case "status":
      return "git status --short";
  }
}

function recordAction(
  repository: WorkingDocumentationRepository,
  action: string,
  status: RepositoryActionRecord["status"],
  details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
): RepositoryActionRecord {
  return recordRepositoryAction(repository, action, status, details);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 20)}\n...[truncated]`;
}
