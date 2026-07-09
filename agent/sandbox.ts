import { createHash } from "node:crypto";

import { defineSandbox, type SandboxNetworkPolicy } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";
import { vercel } from "eve/sandbox/vercel";

import {
  WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH,
  WORKING_REPOSITORY_SANDBOX_NETWORK_ALLOWLIST,
} from "./lib/repository-contract.js";

const workingRepositoryNetworkPolicy = {
  allow: [...WORKING_REPOSITORY_SANDBOX_NETWORK_ALLOWLIST],
  subnets: {
    deny: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"],
  },
} satisfies SandboxNetworkPolicy;

const sandboxBackend = process.env.VERCEL || process.env.EVE_SANDBOX_BACKEND === "vercel"
  ? vercel({ networkPolicy: workingRepositoryNetworkPolicy })
  : microsandbox({
      cpus: 2,
      memoryMiB: 4096,
      networkPolicy: workingRepositoryNetworkPolicy,
    });

const evalRepositoryCacheEnabled =
  process.env.DOCS_MAINTAINER_EVAL_REPOSITORY_CACHE === "1";

const evalRepositoryCacheSeed = {
  repositoryUrl: "https://github.com/peelar/saleor-docs.git",
  ref: "main",
  docsRoot: "docs",
  sandboxPath: WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH,
};

export default defineSandbox({
  backend: sandboxBackend,
  revalidationKey: () =>
    evalRepositoryCacheEnabled
      ? `docs-maintainer-eval-repository-cache:v1:${evalRepositoryCacheSeed.repositoryUrl}:${evalRepositoryCacheSeed.ref}:${evalRepositoryCacheSeed.docsRoot}`
      : "docs-maintainer-no-eval-repository-cache:v1",
  async bootstrap({ use }) {
    const sandbox = await use();

    if (!evalRepositoryCacheEnabled) return;

    const cachePath = repositoryCacheCheckoutPath(evalRepositoryCacheSeed);
    const markerPath = repositoryCacheMarkerPath(evalRepositoryCacheSeed);

    const result = await sandbox.run({
      command: [
        "set -eu",
        `cache_path=${sh(cachePath)}`,
        `rm -rf "$cache_path"`,
        `mkdir -p "$(dirname "$cache_path")"`,
        `git clone --depth=1 --branch ${sh(evalRepositoryCacheSeed.ref)} ${sh(evalRepositoryCacheSeed.repositoryUrl)} "$cache_path"`,
        `cd "$cache_path"`,
        `resolved_commit="$(git rev-parse HEAD)"`,
        `printf '\\n__DOCS_MAINTAINER_CACHE__%s\\n' "$resolved_commit"`,
      ].join("\n"),
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to seed eval repository cache: ${result.stderr || result.stdout}`,
      );
    }

    const cacheResult = result.stdout.match(
      /__DOCS_MAINTAINER_CACHE__([a-f0-9]{40})/,
    );
    if (cacheResult === null) {
      throw new Error("Failed to read seeded eval repository cache metadata.");
    }

    const [, resolvedCommit] = cacheResult;

    await sandbox.writeTextFile({
      path: markerPath,
      content: `${JSON.stringify(
        {
          version: 1,
          repositoryUrl: evalRepositoryCacheSeed.repositoryUrl,
          requestedRef: evalRepositoryCacheSeed.ref,
          docsRoot: evalRepositoryCacheSeed.docsRoot,
          sourcePath: cachePath,
          resolvedCommit,
          status: "ready",
        },
        null,
        2,
      )}\n`,
    });
  },
});

function repositoryCacheCheckoutPath(seed: typeof evalRepositoryCacheSeed): string {
  return `${repositoryCacheDirectory(seed)}/checkout`;
}

function repositoryCacheMarkerPath(seed: typeof evalRepositoryCacheSeed): string {
  return `${repositoryCacheDirectory(seed)}/marker.json`;
}

function repositoryCacheDirectory(seed: typeof evalRepositoryCacheSeed): string {
  return `/workspace/.docs-maintainer-cache/repositories/${hashText(
    [
      normalizeRepositoryUrl(seed.repositoryUrl),
      seed.ref,
      seed.docsRoot,
    ].join("\n"),
  )}`;
}

function normalizeRepositoryUrl(value: string): string {
  return value.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sh(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
