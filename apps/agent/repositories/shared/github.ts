import { getToken } from "@vercel/connect";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "./errors";
import type { RepositoryResult, RepositoryResultAsync } from "./errors";
import type { GitHubRepository, ResolvedRepository } from "./types";

const DEFAULT_GITHUB_CONNECTOR = "github/docs-agent";
const GITHUB_API_VERSION = "2026-03-10";

/** Obtains a GitHub App installation token scoped to one configured repository. */
export function resolveGitHubToken(
  repository: GitHubRepository,
): RepositoryResultAsync<string> {
  const connector =
    process.env.PAIGE_GITHUB_CONNECTOR?.trim() || DEFAULT_GITHUB_CONNECTOR;

  return ResultAsync.fromPromise(
    getToken(connector, {
      subject: { type: "app" },
      authorizationDetails: [
        {
          type: "github_app_installation",
          org: repository.owner,
          repositories: [repository.name],
        },
      ],
    }),
    (cause) =>
      new RepositoryError(
        "REPOSITORY_GITHUB_AUTH_FAILED",
        `Failed to authenticate GitHub connector ${connector}.`,
        { cause },
      ),
  );
}

/** Resolves the repository's default branch to an immutable commit SHA. */
export function resolveGitHubRevision<TRepository extends GitHubRepository>(
  repository: TRepository,
  token: string | undefined,
  abortSignal: AbortSignal,
): RepositoryResultAsync<ResolvedRepository<TRepository>> {
  const repositoryPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

  return githubJson(repositoryPath, token, abortSignal)
    .andThen((details) =>
      readStringProperty(
        details,
        "default_branch",
        "GitHub repository response",
      ),
    )
    .andThen((ref) =>
      githubJson(
        `${repositoryPath}/commits/${encodeURIComponent(ref)}`,
        token,
        abortSignal,
      ).andThen((commit) =>
        readStringProperty(commit, "sha", "GitHub commit response").map(
          (resolvedRevision) => ({ ...repository, ref, resolvedRevision }),
        ),
      ),
    );
}

/** Downloads the immutable repository snapshot selected by resolvedRevision. */
export function downloadRepositoryArchive(
  repository: ResolvedRepository,
  token: string | undefined,
  abortSignal: AbortSignal,
): RepositoryResultAsync<ReadableStream<Uint8Array>> {
  const path = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tarball/${encodeURIComponent(repository.resolvedRevision)}`;
  return githubFetch(path, token, abortSignal).andThen((response) =>
    response.body === null
      ? err(
          new RepositoryError(
            "REPOSITORY_GITHUB_FAILED",
            `GitHub returned an empty archive for repository ${repository.id}.`,
          ),
        )
      : ok(response.body),
  );
}

function githubJson(
  path: string,
  token: string | undefined,
  abortSignal: AbortSignal,
): RepositoryResultAsync<unknown> {
  return githubFetch(path, token, abortSignal).andThen((response) =>
    ResultAsync.fromPromise(
      response.json(),
      (cause) =>
        new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub returned invalid JSON: ${path}`,
          { cause },
        ),
    ),
  );
}

function githubFetch(
  path: string,
  token: string | undefined,
  abortSignal: AbortSignal,
): RepositoryResultAsync<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;

  const request = fetch(`https://api.github.com${path}`, {
    headers,
    signal: abortSignal,
  }).then(
    (response) =>
      response.ok
        ? ok(response)
        : err(
            new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              `GitHub request failed with HTTP ${response.status}: ${path}`,
            ),
          ),
    (cause) => {
      // Cancellation is control flow owned by Eve, not a GitHub domain error.
      // Preserve the rejection so the active turn stops immediately.
      if (abortSignal.aborted) return Promise.reject(cause);
      return err(
        new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub request failed: ${path}`,
          { cause },
        ),
      );
    },
  );

  return new ResultAsync(request);
}

function readStringProperty(
  value: unknown,
  property: string,
  label: string,
): RepositoryResult<string> {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} is missing ${property}.`,
      ),
    );
  }
  const result = (value as Record<string, unknown>)[property];
  if (typeof result !== "string" || result.length === 0) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ),
    );
  }
  return ok(result);
}
