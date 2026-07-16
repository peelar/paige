import assert from "node:assert/strict";

import type { ToolContext } from "eve/tools";
import { err, ResultAsync } from "neverthrow";
import { afterEach, describe, test, vi } from "vitest";

import {
  GitHubRepositoryMetadataService,
} from "../repositories/metadata/service";
import { RepositoryError } from "../repositories/shared/errors";
import type { RepositoryConfig } from "../repositories/types";

const repository: RepositoryConfig = {
  id: "saleor-core",
  owner: "saleor",
  name: "saleor",
  role: "evidence",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository metadata service", () => {
  test("lists releases with source URLs and timestamps unchanged", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      {
        id: 42,
        tag_name: "3.21.0",
        name: "Saleor 3.21",
        published_at: "2026-07-10T12:34:56Z",
        html_url: "https://github.com/saleor/saleor/releases/tag/3.21.0",
        draft: false,
        prerelease: true,
      },
      {
        id: 41,
        tag_name: "3.20.0",
        name: "Beyond the requested limit",
        published_at: "2026-06-10T12:34:56Z",
        html_url: "https://github.com/saleor/saleor/releases/tag/3.20.0",
        draft: false,
        prerelease: false,
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { service, getSandbox } = createService();
    const result = await service.listReleases({
      repositoryId: repository.id,
      limit: 1,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, [
      {
        id: 42,
        tagName: "3.21.0",
        name: "Saleor 3.21",
        publishedAt: "2026-07-10T12:34:56Z",
        url: "https://github.com/saleor/saleor/releases/tag/3.21.0",
        draft: false,
        prerelease: true,
      },
    ]);
    assert.match(fetchMock.mock.calls[0][0].toString(), /releases\?per_page=1$/);
    assert.equal(getSandbox.mock.calls.length, 0);
  });

  test("lists only open issues and applies the requested result limit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      {
        number: 101,
        title: "Pull request returned by the issues endpoint",
        state: "open",
        html_url: "https://github.com/saleor/saleor/pull/101",
        labels: [],
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-11T00:00:00Z",
        pull_request: {
          html_url: "https://github.com/saleor/saleor/pull/101",
        },
      },
      {
        number: 100,
        title: "Keep the source timestamp",
        state: "open",
        html_url: "https://github.com/saleor/saleor/issues/100",
        labels: [{ name: "bug" }, "triage"],
        created_at: "2026-07-02T01:02:03Z",
        updated_at: "2026-07-12T04:05:06Z",
      },
      {
        number: 99,
        title: "Second issue beyond the result cap",
        state: "open",
        html_url: "https://github.com/saleor/saleor/issues/99",
        labels: [],
        created_at: "2026-07-01T01:02:03Z",
        updated_at: "2026-07-11T04:05:06Z",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { service } = createService();
    const result = await service.listOpenIssues({
      repositoryId: repository.id,
      limit: 1,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, [
      {
        number: 100,
        title: "Keep the source timestamp",
        state: "open",
        url: "https://github.com/saleor/saleor/issues/100",
        labels: ["bug", "triage"],
        createdAt: "2026-07-02T01:02:03Z",
        updatedAt: "2026-07-12T04:05:06Z",
      },
    ]);
    const url = fetchMock.mock.calls[0][0].toString();
    assert.match(url, /issues\?/);
    assert.match(url, /filter=all/);
    assert.match(url, /state=open/);
    assert.match(url, /sort=updated/);
    assert.match(url, /direction=desc/);
    assert.match(url, /per_page=100/);
  });

  test("lists open pull requests with their exact head and base refs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      {
        number: 77,
        title: "Update checkout docs",
        state: "open",
        html_url: "https://github.com/saleor/saleor/pull/77",
        draft: true,
        head: { sha: "abcdef0123456789" },
        base: { ref: "main" },
        updated_at: "2026-07-13T10:11:12Z",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { service } = createService();
    const result = await service.listOpenPullRequests({
      repositoryId: repository.id,
      limit: 3,
    });

    assert(result.isOk());
    assert.deepEqual(result.value, [
      {
        number: 77,
        title: "Update checkout docs",
        state: "open",
        url: "https://github.com/saleor/saleor/pull/77",
        draft: true,
        headCommitSha: "abcdef0123456789",
        baseRef: "main",
        updatedAt: "2026-07-13T10:11:12Z",
      },
    ]);
    const url = fetchMock.mock.calls[0][0].toString();
    assert.match(url, /pulls\?/);
    assert.match(url, /per_page=3/);
  });

  test("lists tags and recent commits without normalizing source data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([
        {
          name: "3.21.0",
          commit: { sha: "tagged-commit-sha" },
        },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        {
          sha: "recent-commit-sha",
          html_url:
            "https://github.com/saleor/saleor/commit/recent-commit-sha",
          commit: {
            message: "Preserve the full commit message\n\nWith its body.",
            author: { date: "2026-07-14T08:09:10Z" },
          },
        },
        {
          sha: "missing-author-sha",
          html_url:
            "https://github.com/saleor/saleor/commit/missing-author-sha",
          commit: {
            message: "Commit without an author timestamp",
            author: null,
          },
        },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const { service } = createService();
    const tags = await service.listTags({
      repositoryId: repository.id,
      limit: 2,
    });
    const commits = await service.listCommits({
      repositoryId: repository.id,
      limit: 2,
    });

    assert(tags.isOk());
    assert.deepEqual(tags.value, [
      { name: "3.21.0", commitSha: "tagged-commit-sha" },
    ]);
    assert(commits.isOk());
    assert.deepEqual(commits.value, [
      {
        sha: "recent-commit-sha",
        message: "Preserve the full commit message\n\nWith its body.",
        authoredAt: "2026-07-14T08:09:10Z",
        url: "https://github.com/saleor/saleor/commit/recent-commit-sha",
      },
      {
        sha: "missing-author-sha",
        message: "Commit without an author timestamp",
        authoredAt: null,
        url: "https://github.com/saleor/saleor/commit/missing-author-sha",
      },
    ]);
    assert.match(fetchMock.mock.calls[0][0].toString(), /tags\?per_page=2$/);
    assert.match(fetchMock.mock.calls[1][0].toString(), /commits\?per_page=2$/);
  });

  test("rejects invalid input before authentication or network access", async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = createContext();
    const service = new GitHubRepositoryMetadataService(ctx, {
      repositories: [repository],
      getGitHubToken: () => {
        tokenRequests += 1;
        return ResultAsync.fromSafePromise(Promise.resolve("token"));
      },
    });

    const invalidLimit = await service.listCommits({
      repositoryId: repository.id,
      limit: 101,
    });
    const unconfigured = await service.listTags({
      repositoryId: "unconfigured",
      limit: 1,
    });

    assert(invalidLimit.isErr());
    assert.equal(invalidLimit.error.code, "REPOSITORY_INVALID_INPUT");
    assert(unconfigured.isErr());
    assert.equal(unconfigured.error.code, "REPOSITORY_NOT_CONFIGURED");
    assert.equal(tokenRequests, 0);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  test("preserves authentication and malformed-response failures", async () => {
    const authError = new RepositoryError(
      "REPOSITORY_GITHUB_AUTH_FAILED",
      "connector unavailable",
    );
    const { ctx } = createContext();
    const unavailable = new GitHubRepositoryMetadataService(ctx, {
      repositories: [repository],
      getGitHubToken: () => new ResultAsync(Promise.resolve(err(authError))),
    });

    const authResult = await unavailable.listReleases({
      repositoryId: repository.id,
      limit: 1,
    });

    assert(authResult.isErr());
    assert.equal(authResult.error, authError);

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
        { tag_name: "missing required release fields" },
      ])),
    );
    const malformed = await createService().service.listReleases({
      repositoryId: repository.id,
      limit: 1,
    });

    assert(malformed.isErr());
    assert.equal(malformed.error.code, "REPOSITORY_GITHUB_FAILED");
    assert.match(malformed.error.message, /releases response is invalid/);
  });
});

function createService() {
  const { ctx, getSandbox } = createContext();
  return {
    service: new GitHubRepositoryMetadataService(ctx, {
      repositories: [repository],
      getGitHubToken: () =>
        ResultAsync.fromSafePromise(Promise.resolve("secret-token")),
    }),
    getSandbox,
  };
}

function createContext() {
  const getSandbox = vi.fn<ToolContext["getSandbox"]>();
  return {
    ctx: {
      abortSignal: new AbortController().signal,
      getSandbox,
    } as unknown as ToolContext,
    getSandbox,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
