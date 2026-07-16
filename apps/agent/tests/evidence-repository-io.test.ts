import assert from "node:assert/strict";

import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, ResultAsync } from "neverthrow";
import { afterEach, describe, test, vi } from "vitest";

import {
  ensureEvidenceRepositoryCheckout,
} from "../repositories/evidence/checkout";
import {
  readEvidenceRepositoryFile,
  searchEvidenceRepository,
} from "../repositories/evidence/inspection";
import { EvidenceRepositoryService } from "../repositories/evidence/service";
import type { EvidenceRepository } from "../repositories/evidence/types";
import { RepositoryError } from "../repositories/shared/errors";
import {
  downloadRepositoryArchive,
  resolveGitHubRevision,
} from "../repositories/shared/github";
import { serializeSandbox } from "../repositories/shared/serialization";
import type {
  RepositoryCheckout,
  ResolvedRepository,
} from "../repositories/shared/types";

const repository: EvidenceRepository = {
  id: "saleor-core",
  owner: "saleor",
  name: "saleor",
  type: "evidence",
  access: "github-app",
};
const resolvedRepository: ResolvedRepository<EvidenceRepository> = {
  ...repository,
  ref: "main",
  resolvedRevision: "0123456789abcdef0123456789abcdef01234567",
};
const checkout: RepositoryCheckout<EvidenceRepository> = {
  path: "/workspace/evidence-repositories/saleor-core",
  repository: resolvedRepository,
};

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

describe("repository checkout", () => {
  test("reuses a checkout whose metadata matches the resolved revision", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ sha: resolvedRepository.resolvedRevision }));
    vi.stubGlobal("fetch", fetchMock);
    const sandbox = createSandbox({
      readTextFile: vi
        .fn<SandboxSession["readTextFile"]>()
        .mockResolvedValue(JSON.stringify(resolvedRepository)),
    });

    const result = await ensureEvidenceRepositoryCheckout({
      sandbox,
      repository,
      getGitHubToken: () => ResultAsync.fromSafePromise(Promise.resolve("token")),
      abortSignal: new AbortController().signal,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, checkout);
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(sandbox.writeFile.mock.calls.length, 0);
    assert.equal(sandbox.run.mock.calls.length, 0);
  });

  test("removes temporary files and returns a typed error after extraction fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ sha: resolvedRepository.resolvedRevision }))
      .mockResolvedValueOnce(new Response("archive"));
    vi.stubGlobal("fetch", fetchMock);
    const removePath = vi
      .fn<SandboxSession["removePath"]>()
      .mockResolvedValue(undefined);
    const sandbox = createSandbox({
      readTextFile: vi
        .fn<SandboxSession["readTextFile"]>()
        .mockResolvedValue(null),
      removePath,
      run: vi.fn<SandboxSession["run"]>().mockResolvedValue(
        commandResult({ exitCode: 2, stderr: "invalid archive" }),
      ),
    });

    const result = await ensureEvidenceRepositoryCheckout({
      sandbox,
      repository,
      getGitHubToken: () => ResultAsync.fromSafePromise(Promise.resolve("token")),
      abortSignal: new AbortController().signal,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_SANDBOX_FAILED");
    assert.match(result.error.message, /invalid archive/);
    assert.deepEqual(
      removePath.mock.calls.map(([input]) => ({
        path: input.path,
        recursive: input.recursive,
      })),
      [
        {
          path: "/workspace/evidence-repositories/saleor-core.staging",
          recursive: true,
        },
        {
          path:
            "/workspace/evidence-repositories/.saleor-core-0123456789ab.tar.gz",
          recursive: undefined,
        },
        {
          path: "/workspace/evidence-repositories/saleor-core.staging",
          recursive: true,
        },
      ],
    );
    assert.match(
      sandbox.run.mock.calls[0][0].command,
      /find .* -type l -delete/,
    );
  });
});

describe("repository inspection", () => {
  test("rejects missing files before reading their content", async () => {
    const sandbox = createSandbox({
      run: vi
        .fn<SandboxSession["run"]>()
        .mockResolvedValue(commandResult({ exitCode: 1 })),
    });

    const result = await readEvidenceRepositoryFile({
      sandbox,
      checkout,
      abortSignal: new AbortController().signal,
      path: "missing.md",
      startLine: 1,
      maxCharacters: 24_000,
    });

    assert(result.isErr());
    assert.equal(result.error.code, "REPOSITORY_FILE_NOT_FOUND");
    assert.equal(sandbox.readTextFile.mock.calls.length, 0);
  });

  test("returns bounded content and the inspected blob SHA", async () => {
    const sandbox = createSandbox({
      run: vi
        .fn<SandboxSession["run"]>()
        .mockResolvedValueOnce(commandResult())
        .mockResolvedValueOnce(commandResult({ stdout: "14\n" }))
        .mockResolvedValueOnce(commandResult({ stdout: "blob-sha\n" })),
      readTextFile: vi
        .fn<SandboxSession["readTextFile"]>()
        .mockResolvedValue("one\ntwo\nthree"),
    });

    const result = await readEvidenceRepositoryFile({
      sandbox,
      checkout,
      abortSignal: new AbortController().signal,
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
  });

  test("parses bounded search matches and ignores malformed output", async () => {
    const longExcerpt = "x".repeat(600);
    const sandbox = createSandbox({
      run: vi.fn<SandboxSession["run"]>().mockResolvedValue(
        commandResult({
          stdout: `./docs/a.md:12:first\nmalformed\nsrc/b.ts:3:${longExcerpt}\n`,
        }),
      ),
    });

    const result = await searchEvidenceRepository({
      sandbox,
      checkout,
      abortSignal: new AbortController().signal,
      query: "literal",
      pathPrefix: ".",
      limit: 1,
    });

    assert(result.isOk());
    assert.deepEqual(result.value.matches, [
      { path: "docs/a.md", line: 12, excerpt: "first" },
    ]);
    assert.equal(result.value.truncated, true);
    assert.match(
      sandbox.run.mock.calls[0][0].command,
      /--fixed-strings -- 'literal'/,
    );
  });
});

describe("repository GitHub boundary", () => {
  test("uses the pinned API version and resolves an immutable revision", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ sha: resolvedRepository.resolvedRevision }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGitHubRevision(
      repository,
      "secret-token",
      new AbortController().signal,
    );

    assert(result.isOk());
    assert.deepEqual(result.value, resolvedRepository);
    const [, options] = fetchMock.mock.calls[0];
    assert.deepEqual(options?.headers, {
      accept: "application/vnd.github+json",
      authorization: "Bearer secret-token",
      "x-github-api-version": "2026-03-10",
    });
  });

  test("maps HTTP and empty archive responses to GitHub errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const revision = await resolveGitHubRevision(
      repository,
      "token",
      new AbortController().signal,
    );
    const archive = await downloadRepositoryArchive(
      resolvedRepository,
      "token",
      new AbortController().signal,
    );

    assert(revision.isErr());
    assert.equal(revision.error.code, "REPOSITORY_GITHUB_FAILED");
    assert.match(revision.error.message, /HTTP 403/);
    assert(archive.isErr());
    assert.equal(archive.error.code, "REPOSITORY_GITHUB_FAILED");
    assert.match(archive.error.message, /empty archive/);
  });

  test("preserves cancellation as a rejected promise", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancelled");
    controller.abort();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cancellation));

    await assert.rejects(
      async () =>
        await resolveGitHubRevision(repository, "token", controller.signal),
      cancellation,
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
    const service = new EvidenceRepositoryService(ctx, {
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

  test("preserves typed checkout failures", async () => {
    const checkoutError = new RepositoryError(
      "REPOSITORY_GITHUB_AUTH_FAILED",
      "connector unavailable",
    );
    const ctx = {
      abortSignal: new AbortController().signal,
      getSandbox: async () =>
        createSandbox({ id: "sandbox-checkout-failure" }),
    } as unknown as ToolContext;
    const service = new EvidenceRepositoryService(ctx, {
      repositories: [repository],
      getGitHubToken: () => new ResultAsync(Promise.resolve(err(checkoutError))),
    });

    const result = await service.listFiles({
      repositoryId: repository.id,
      pathPrefix: ".",
      limit: 10,
    });

    assert(result.isErr());
    assert.equal(result.error, checkoutError);
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
    readTextFile: ReturnType<typeof vi.fn>;
    removePath: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
  };
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
