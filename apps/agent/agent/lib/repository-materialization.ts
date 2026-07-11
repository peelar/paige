import type { SandboxCommandResult, SandboxNetworkPolicy } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  WORKING_REPOSITORY_SANDBOX_NETWORK_ALLOWLIST,
  type WatchedRepository,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";

export const repositoryActionRecordSchema = z.object({
  action: z.string(),
  target: z.string().optional(),
  commandCategory: z.string().optional(),
  provenanceLabel: z.string(),
  status: z.enum(["success", "failure"]),
  reason: z.string().optional(),
});

export type RepositoryActionRecord = z.infer<typeof repositoryActionRecordSchema>;

export type WatchedRepositoryCheckoutAccess =
  | { mode: "github-app"; token: string }
  | { mode: "public-github" };

export type WorkingRepositoryMaterializationPolicy = {
  authority: "working-documentation";
  accessMode: "sandbox-write";
  repository: WorkingDocumentationRepository;
  requestedRef: string;
};

export type WatchedRepositoryMaterializationPolicy = {
  authority: "watched-evidence";
  accessMode: "sandbox-read";
  repository: WatchedRepository;
  requestedRef: string;
  access: WatchedRepositoryCheckoutAccess;
};

export type RepositoryMaterializationPolicy =
  | WorkingRepositoryMaterializationPolicy
  | WatchedRepositoryMaterializationPolicy;

const PRIVATE_SUBNETS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
] as const;

export class RepositoryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryPolicyError";
  }
}

export function workingRepositoryMaterializationPolicy(
  repository: WorkingDocumentationRepository,
): WorkingRepositoryMaterializationPolicy {
  return {
    authority: "working-documentation",
    accessMode: "sandbox-write",
    repository,
    requestedRef: repository.ref,
  };
}

export function watchedRepositoryMaterializationPolicy(
  repository: WatchedRepository,
  requestedRef: string,
  access: WatchedRepositoryCheckoutAccess,
): WatchedRepositoryMaterializationPolicy {
  return {
    authority: "watched-evidence",
    accessMode: "sandbox-read",
    repository,
    requestedRef,
    access,
  };
}

export function assertRepositoryMaterializationAllowed(
  policy: RepositoryMaterializationPolicy,
): void {
  if (!policy.repository.allowedActions.includes("clone")) {
    if (policy.authority === "working-documentation") {
      throw new RepositoryPolicyError("Repository action is not allowed: clone");
    }
    throw new Error("Watched repository action is not allowed: clone");
  }

  const path = policy.repository.sandboxPath;
  if (policy.authority === "working-documentation") {
    if (!path.startsWith("/workspace/") || path.split("/").includes("..")) {
      throw new RepositoryPolicyError(`Sandbox path must stay under /workspace: ${path}`);
    }
    return;
  }

  if (
    !path.startsWith("/workspace/watched/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new Error(`Watched repository sandbox path must stay under /workspace/watched: ${path}`);
  }
}

export async function cloneRepositoryCheckout(
  ctx: ToolContext,
  policy: RepositoryMaterializationPolicy,
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  assertRepositoryMaterializationAllowed(policy);

  const sandbox = await ctx.getSandbox();
  if (policy.authority === "watched-evidence") {
    await configureWatchedRepositoryAccess(ctx, policy, actionProvenance);
  }

  await sandbox.removePath({
    path: policy.repository.sandboxPath,
    recursive: true,
    force: true,
    abortSignal: ctx.abortSignal,
  });

  const cloneCommand = [
    "git",
    "clone",
    "--depth=1",
    "--branch",
    quoteShellArgument(policy.requestedRef),
    quoteShellArgument(policy.repository.source.url),
    quoteShellArgument(policy.repository.sandboxPath),
  ].join(" ");

  let clone = await sandbox.run({ command: cloneCommand, abortSignal: ctx.abortSignal });

  if (clone.exitCode !== 0) {
    await sandbox.removePath({
      path: policy.repository.sandboxPath,
      recursive: true,
      force: true,
      abortSignal: ctx.abortSignal,
    });
    const fallbackCommand = [
      "git",
      "clone",
      quoteShellArgument(policy.repository.source.url),
      quoteShellArgument(policy.repository.sandboxPath),
      "&&",
      "git",
      "-C",
      quoteShellArgument(policy.repository.sandboxPath),
      "checkout",
      quoteShellArgument(policy.requestedRef),
    ].join(" ");
    clone = await sandbox.run({ command: fallbackCommand, abortSignal: ctx.abortSignal });
  }

  if (clone.exitCode !== 0) {
    const reason = summarizeCommandFailure(clone);
    actionProvenance.push(
      recordRepositoryAction(policy.repository, "clone", "failure", {
        target: policy.authority === "watched-evidence"
          ? `${policy.repository.source.url}#${policy.requestedRef}`
          : undefined,
        reason,
      }),
    );
    throw cloneFailure(policy, reason);
  }

  actionProvenance.push(
    recordRepositoryAction(policy.repository, "clone", "success", {
      target: policy.authority === "watched-evidence"
        ? `${policy.repository.sandboxPath}#${policy.requestedRef}`
        : policy.repository.sandboxPath,
    }),
  );
}

export async function resolveRepositoryCommit(
  ctx: ToolContext,
  sandboxPath: string,
): Promise<string | undefined> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: `git -C ${quoteShellArgument(sandboxPath)} rev-parse HEAD`,
    abortSignal: ctx.abortSignal,
  });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

export function recordRepositoryAction(
  repository: WorkingDocumentationRepository | WatchedRepository,
  action: string,
  status: RepositoryActionRecord["status"],
  details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
): RepositoryActionRecord {
  return {
    action,
    provenanceLabel: repository.provenanceLabel,
    status,
    ...details,
  };
}

export function summarizeCommandFailure(result: SandboxCommandResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  return truncate(stderr || stdout || `Command exited with ${result.exitCode}.`, 1_000);
}

export function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function joinSandboxPath(root: string, path: string): string {
  if (path === ".") return root;
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function normalizeRepositoryUrl(value: string): string {
  return value.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

async function configureWatchedRepositoryAccess(
  ctx: ToolContext,
  policy: WatchedRepositoryMaterializationPolicy,
  actionProvenance: RepositoryActionRecord[],
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  if (policy.access.mode === "public-github") {
    await sandbox.setNetworkPolicy({
      allow: [...WORKING_REPOSITORY_SANDBOX_NETWORK_ALLOWLIST],
      subnets: { deny: [...PRIVATE_SUBNETS] },
    });
    return;
  }

  const authorization = `Basic ${Buffer.from(
    `x-access-token:${policy.access.token}`,
  ).toString("base64")}`;
  const networkPolicy = {
    allow: {
      "github.com": [{ transform: [{ headers: { authorization } }] }],
      "*": [],
    },
    subnets: { deny: [...PRIVATE_SUBNETS] },
  } satisfies SandboxNetworkPolicy;
  await sandbox.setNetworkPolicy(networkPolicy);
  actionProvenance.push(
    recordRepositoryAction(policy.repository, "broker-github-token", "success", {
      target: "github.com",
      reason: "Using GitHub App access for watched repository materialization.",
    }),
  );
}

function cloneFailure(policy: RepositoryMaterializationPolicy, reason: string): Error {
  if (policy.authority === "working-documentation") {
    return new Error(`Failed to clone working documentation repository: ${reason}`);
  }
  return new Error(`Failed to clone watched repository ${policy.repository.id}: ${reason}`);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 20)}\n...[truncated]`;
}
