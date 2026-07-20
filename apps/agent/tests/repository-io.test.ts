import assert from "node:assert/strict";

import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, ResultAsync } from "neverthrow";
import { afterEach, describe, test, vi } from "vitest";

import { SandboxGit } from "../repositories/git";
import { RepositoryFiles } from "../repositories/files";
import { RepositoryService } from "../repositories/service";
import { RepositoryError } from "../repositories/shared/errors";
import {
  createGitHubRequest,
  GitHubRepository,
} from "../repositories/shared/github";
import { serializeSandbox } from "../repositories/shared/serialization";
import type {
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "../repositories/types";

const repository: RepositoryConfig = {
  id: "saleor-core",
  owner: "saleor",
  name: "saleor",
  role: "evidence",
};
const resolvedRepository: ResolvedRepository = {
  ...repository,
  isPrivate: false,
  ref: "main",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
};
const workspace: RepositoryWorkspace = {
  path: "/workspace/repositories/saleor-core",
  repository: resolvedRepository,
};
const remoteUrl = "https://github.com/saleor/saleor.git";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository sandbox serialization", () => {
  test("runs tasks for one sandbox sequentially", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = serializeSandbox(
      "sandbox-1",
      () =>
        new ResultAsync(
          (async () => {
            events.push("first:start");
            markFirstStarted?.();
            await firstGate;
            events.push("first:end");
            return ok("first");
          })(),
        ),
    );
    const second = serializeSandbox(
      "sandbox-1",
      () =>
        new ResultAsync(
          Promise.resolve().then(() => {
            events.push("second:start");
            return ok("second");
          }),
        ),
    );

    await firstStarted;
    assert.deepEqual(events, ["first:start"]);

    assert.ok(releaseFirst);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert(firstResult.isOk());
    assert(secondResult.isOk());
    assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
  });

  test("continues the queue after an unexpected rejection", async () => {
    const failure = new Error("sandbox disconnected");
    const first = serializeSandbox(
      "sandbox-rejection",
      () => new ResultAsync(Promise.reject(failure)),
    );
    let secondRan = false;
    const second = serializeSandbox(
      "sandbox-rejection",
      () =>
        new ResultAsync(
          Promise.resolve().then(() => {
            secondRan = true;
            return ok("recovered");
          }),
        ),
    );

    await assert.rejects(async () => await first, failure);
    const secondResult = await second;

    assert(secondResult.isOk());
    assert.equal(secondResult.value, "recovered");
    assert.equal(secondRan, true);
  });
});

describe("Git repository cache", () => {
  test("reuses a cached shallow repository when the commit is already present", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult(),
        commandResult({ stdout: `${remoteUrl}\n` }),
        commandResult(),
        commandResult(),
      ]),
    });

    const git = new SandboxGit(sandbox);
    const result = await git.ensureCommits({
      repository,
      commits: [resolvedRepository],
      token: "token",
    });

    assert(result.isOk());
    assert.deepEqual(result.value, [workspace]);
    assert.equal(sandbox.setNetworkPolicy.mock.calls.length, 0);
    assert.equal(sandbox.removePath.mock.calls.length, 0);
  });

  test("initializes and shallow-fetches a missing commit with brokered auth", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult(),
      ]),
    });

    const git = new SandboxGit(sandbox);
    const result = await git.ensureCommits({
      repository,
      commits: [resolvedRepository],
      token: "secret-token",
    });

    assert(result.isOk());
    assert.match(
      sandbox.run.mock.calls[1][0].command,
      /git init && git remote add origin/,
    );
    assert.match(
      sandbox.run.mock.calls[3][0].command,
      new RegExp(
        `git fetch --depth=1 --no-tags origin '${resolvedRepository.commitSha}'`,
      ),
    );
    assert.deepEqual(sandbox.setNetworkPolicy.mock.calls[1], ["deny-all"]);
    const brokerPolicy = sandbox.setNetworkPolicy.mock.calls[0][0];
    assert.equal("github.com" in brokerPolicy.allow, true);
    assert.equal(JSON.stringify(brokerPolicy).includes("Authorization"), false);
    assert.equal(
      JSON.stringify(brokerPolicy).includes("secret-token"),
      false,
    );
  });

  test("brokers the shared token only for a verified private repository", async () => {
    const privateCommit: ResolvedRepository = {
      ...resolvedRepository,
      isPrivate: true,
    };
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult(),
      ]),
    });

    const git = new SandboxGit(sandbox);
    const result = await git.ensureCommits({
      repository,
      commits: [privateCommit],
      token: "secret-token",
    });

    assert(result.isOk());
    const brokerPolicy = sandbox.setNetworkPolicy.mock.calls[0][0];
    assert.equal(JSON.stringify(brokerPolicy).includes("Authorization"), true);
    assert.equal(
      JSON.stringify(brokerPolicy).includes("secret-token"),
      false,
    );
  });

  test("restores deny-all and returns a typed error when fetch fails", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ exitCode: 1 }),
        commandResult(),
        commandResult({ exitCode: 1 }),
        commandResult({ exitCode: 128, stderr: "repository not found" }),
      ]),
    });

    const git = new SandboxGit(sandbox);
    const result = await git.ensureCommits({
      repository,
      commits: [resolvedRepository],
      token: "token",
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_SANDBOX_FAILED");
    assert.match(result.error.message, /repository not found/);
    assert.deepEqual(sandbox.setNetworkPolicy.mock.calls[1], ["deny-all"]);
  });

  test("never discards an existing dirty working tree", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ stdout: " M docs/example.md\n" }),
      ]),
    });

    const git = new SandboxGit(sandbox);
    const result = await git.checkoutCommit(workspace);

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_DIRTY_WORKSPACE");
    assert.equal(sandbox.run.mock.calls.length, 1);
  });
});

describe("repository files", () => {
  test("returns bounded content and the file blob SHA", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ stdout: "blob\n" }),
        commandResult({ stdout: "14\n" }),
        commandResult({ stdout: "one\ntwo\nthree" }),
        commandResult({ stdout: "blob-sha\n" }),
      ]),
    });

    const files = new RepositoryFiles(sandbox, workspace);
    const result = await files.read({
      path: "docs/example.md",
      startLine: 2,
      endLine: 3,
      maxCharacters: 5,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      repository: resolvedRepository,
      path: "docs/example.md",
      blobSha: "blob-sha",
      startLine: 2,
      endLine: 3,
      content: "two\nt",
      truncated: true,
    });
    assert.match(sandbox.run.mock.calls[2][0].command, /git show/);
  });

  test("parses bounded searches at one commit", async () => {
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({
          stdout:
            `${resolvedRepository.commitSha}:docs/a.md\0${12}\0first\n` +
            `${resolvedRepository.commitSha}:src/b.ts\0${3}\0second\n`,
        }),
      ]),
    });

    const files = new RepositoryFiles(sandbox, workspace);
    const result = await files.search({
      query: "literal",
      pathPrefix: ".",
      limit: 1,
    });

    assert(result.isOk());
    assert.deepEqual(result.value.matches, [
      { path: "docs/a.md", line: 12, excerpt: "first" },
    ]);
    assert.equal(result.value.truncated, true);
    assert.match(sandbox.run.mock.calls[0][0].command, /git grep/);
  });

  test("compares two fetched commits without another GitHub API", async () => {
    const headRepository: ResolvedRepository = {
      ...repository,
      isPrivate: false,
      ref: "3.21",
      commitSha: "abcdef0123456789abcdef0123456789abcdef01",
    };
    const sandbox = createSandbox({
      run: commandSequence([
        commandResult({ stdout: "docs/a.md\0src/b.ts\0extra.md\0" }),
      ]),
    });

    const files = new RepositoryFiles(sandbox, {
      path: workspace.path,
      repository: headRepository,
    });
    const result = await files.compareWith(workspace, {
      pathPrefix: ".",
      limit: 2,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, {
      repositoryId: repository.id,
      baseCommitSha: resolvedRepository.commitSha,
      headCommitSha: headRepository.commitSha,
      changedFiles: ["docs/a.md", "src/b.ts"],
      truncated: true,
    });
    assert.match(sandbox.run.mock.calls[0][0].command, /git diff --name-only/);
  });
});

describe("repository GitHub boundary", () => {
  test("uses one GitHub App token and resolves a requested ref", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        default_branch: "main",
        private: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: resolvedRepository.commitSha,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubRepository(
      repository,
      createGitHubRequest({
        token: "secret-token",
        abortSignal: new AbortController().signal,
      }),
    );
    const result = await github.resolveCommit("3.21");

    assert(result.isOk());
    assert.equal(result.value.ref, "3.21");
    assert.deepEqual(fetchMock.mock.calls[0][1]?.headers, {
      accept: "application/vnd.github+json",
      authorization: "Bearer secret-token",
      "x-github-api-version": "2026-03-10",
    });
    assert.match(fetchMock.mock.calls[1][0].toString(), /commits\/3.21$/);
  });

  test("omits authentication for public GitHub requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        default_branch: "main",
        private: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: resolvedRepository.commitSha,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GitHubRepository(
      { ...repository, access: "public" },
      createGitHubRequest({
        abortSignal: new AbortController().signal,
      }),
    ).resolveCommit();

    assert(result.isOk());
    assert.deepEqual(fetchMock.mock.calls[0][1]?.headers, {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
    });
  });

  test("reports a confirmed GitHub rate limit with its reset time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "2000000000",
        },
      })),
    );

    const result = await new GitHubRepository(
      { ...repository, access: "public" },
      createGitHubRequest({
        abortSignal: new AbortController().signal,
      }),
    ).resolveCommit();

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_GITHUB_RATE_LIMITED");
    assert.equal(
      result.error.message,
      "GitHub rate limited this request. Try again after 2033-05-18T03:33:20.000Z.",
    );
  });

  test("preserves cancellation as a rejected promise", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled");
    controller.abort();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cancellation));

    await assert.rejects(
      async () =>
        await new GitHubRepository(
          repository,
          createGitHubRequest({
            token: "token",
            abortSignal: controller.signal,
          }),
        ).resolveCommit("main"),
      cancellation,
    );
  });

  test("treats a missing remote branch as an idempotent absence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 404 }),
      ),
    );

    const result = await new GitHubRepository(
      repository,
      createGitHubRequest({
        token: "token",
        abortSignal: new AbortController().signal,
      }),
    ).resolveBranchCommitSha("paige/example");

    assert(result.isOk());
    assert.equal(result.value, undefined);
  });

  test("reuses an existing approved draft pull request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      {
        number: 42,
        html_url: "https://github.com/saleor/saleor/pull/42",
        title: "Update docs",
        body: null,
        draft: true,
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GitHubRepository(
      repository,
      createGitHubRequest({
        token: "token",
        abortSignal: new AbortController().signal,
      }),
    ).createOrReuseDraftPullRequest({
      branch: "paige/example",
      baseBranch: "main",
      title: "Update docs",
      body: "",
    });

    assert(result.isOk());
    assert.equal(result.value.reused, true);
    assert.equal(result.value.number, 42);
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  test("creates one draft pull request after an empty idempotency lookup", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        number: 43,
        html_url: "https://github.com/saleor/saleor/pull/43",
        draft: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GitHubRepository(
      repository,
      createGitHubRequest({
        token: "token",
        abortSignal: new AbortController().signal,
      }),
    ).createOrReuseDraftPullRequest({
      branch: "paige/example",
      baseBranch: "main",
      title: "Update docs",
      body: "Prepared by Paige.",
    });

    assert(result.isOk());
    assert.equal(result.value.reused, false);
    assert.equal(fetchMock.mock.calls[1][1]?.method, "POST");
    assert.match(
      String(fetchMock.mock.calls[1][1]?.body),
      /"draft":true/,
    );
  });
});

describe("repository service", () => {
  test("short-circuits invalid input before acquiring a sandbox or token", async () => {
    let sandboxRequests = 0;
    let tokenRequests = 0;
    const ctx = {
      abortSignal: new AbortController().signal,
      getSandbox: async () => {
        sandboxRequests += 1;
        return createSandbox();
      },
    } as unknown as ToolContext;
    const service = new RepositoryService(ctx, {
      getGitHubToken: () => {
        tokenRequests += 1;
        return ResultAsync.fromSafePromise(Promise.resolve("token"));
      },
    });

    const result = await service.listFiles({
      repositoryId: repository.id,
      pathPrefix: "../private",
      limit: 10,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_INVALID_INPUT");
    assert.equal(sandboxRequests, 0);
    assert.equal(tokenRequests, 0);
  });

  test("preserves typed GitHub authentication failures", async () => {
    const authError = new RepositoryError(
      "REPOSITORY_GITHUB_AUTH_FAILED",
      "connector unavailable",
    );
    const ctx = {
      abortSignal: new AbortController().signal,
      getSandbox: async () => createSandbox(),
    } as unknown as ToolContext;
    const service = new RepositoryService(ctx, {
      repositories: [repository],
      getGitHubToken: () => new ResultAsync(Promise.resolve(err(authError))),
    });

    const result = await service.listFiles({
      repositoryId: repository.id,
      pathPrefix: ".",
      limit: 10,
    });

    assert(result.isErr());
    assert.equal(result.error, authError);
  });
});

function createSandbox(
  overrides: Partial<
    Record<keyof SandboxSession, ReturnType<typeof vi.fn> | string>
  > = {},
) {
  return {
    id: "sandbox-1",
    readTextFile: vi
      .fn<SandboxSession["readTextFile"]>()
      .mockResolvedValue(null),
    removePath: vi
      .fn<SandboxSession["removePath"]>()
      .mockResolvedValue(undefined),
    resolvePath: vi.fn<SandboxSession["resolvePath"]>((path) => path),
    run: vi
      .fn<SandboxSession["run"]>()
      .mockResolvedValue(commandResult()),
    setNetworkPolicy: vi
      .fn<SandboxSession["setNetworkPolicy"]>()
      .mockResolvedValue(undefined),
    writeFile: vi
      .fn<SandboxSession["writeFile"]>()
      .mockResolvedValue(undefined),
    writeTextFile: vi
      .fn<SandboxSession["writeTextFile"]>()
      .mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SandboxSession & {
    removePath: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    setNetworkPolicy: ReturnType<typeof vi.fn>;
  };
}

function commandSequence(results: SandboxCommandResult[]) {
  const mock = vi.fn<SandboxSession["run"]>();
  for (const result of results) mock.mockResolvedValueOnce(result);
  return mock;
}

function commandResult(
  overrides: Partial<SandboxCommandResult> = {},
): SandboxCommandResult {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "",
    ...overrides,
  } as SandboxCommandResult;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
