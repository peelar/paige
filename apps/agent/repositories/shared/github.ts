import { getToken } from "@vercel/connect";
import { err, ok, Result, ResultAsync } from "neverthrow";

import { RepositoryError } from "./errors";
import type { RepositoryResult, RepositoryResultAsync } from "./errors";
import type {
  RepositoryConfig,
  ResolvedRepository,
} from "../types";

const DEFAULT_GITHUB_CONNECTOR = "github/docs-agent";
const GITHUB_API_VERSION = "2026-03-10";

/** Obtains a GitHub App token scoped to the repository being accessed. */
export function resolveGitHubToken(
  repository: RepositoryConfig,
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
          permissions: repository.role === "documentation"
            ? ["contents:write", "pull_requests:write"]
            : ["contents:read"],
        },
      ],
    }),
    (cause) =>
      new RepositoryError(
        "REPOSITORY_GITHUB_AUTH_FAILED",
        `Failed to authenticate GitHub access for ${repository.owner}/${repository.name}.`,
        { cause },
      ),
  );
}

interface GitHubCommitFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "removed" | "renamed";
}

export interface GitHubCommitDetails {
  message: string;
  parentSha: string;
  files: GitHubCommitFile[];
}

export interface GitHubFileChange {
  path: string;
  content: string | null;
}

interface GitHubRequestOptions {
  allowNotFound?: boolean;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}

export interface GitHubRequest {
  json(
    path: string,
    options?: GitHubRequestOptions,
  ): RepositoryResultAsync<unknown | undefined>;
  graphql(
    query: string,
    variables: Record<string, unknown>,
  ): RepositoryResultAsync<unknown>;
}

/** Binds authentication and turn cancellation to the GitHub HTTP transport. */
export function createGitHubRequest(input: {
  token: string;
  abortSignal: AbortSignal;
}): GitHubRequest {
  return {
    json: (path, options) =>
      githubJson(path, input.token, input.abortSignal, options),
    graphql: (query, variables) =>
      githubGraphql(query, variables, input.token, input.abortSignal),
  };
}

export class GitHubRepository<
  TRepository extends RepositoryConfig = RepositoryConfig,
> {
  readonly #repository: TRepository;
  readonly #request: GitHubRequest;
  readonly #path: string;

  constructor(repository: TRepository, request: GitHubRequest) {
    this.#repository = repository;
    this.#request = request;
    this.#path =
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  }

  /** Resolves a configured ref, tag, or SHA to an immutable commit SHA. */
  resolveCommit(
    requestedRef?: string,
  ): RepositoryResultAsync<ResolvedRepository<TRepository>> {
    return this.#requiredJson(this.#path)
      .andThen((details) =>
        Result.combine([
          requestedRef === undefined
            ? readStringProperty(
                details,
                "default_branch",
                "GitHub repository response",
              )
            : normalizeRequestedRef(requestedRef),
          readBooleanProperty(
            details,
            "private",
            "GitHub repository response",
          ),
        ])
      )
      .andThen(([resolvedRef, isPrivate]) =>
        this.#requiredJson(
          `${this.#path}/commits/${encodeURIComponent(resolvedRef)}`,
        ).andThen((commit) =>
          readStringProperty(commit, "sha", "GitHub commit response").map(
            (commitSha) => ({
              ...this.#repository,
              isPrivate,
              ref: resolvedRef,
              commitSha,
            }),
          )
        )
      );
  }

  /** Resolves one remote branch SHA, or undefined when it does not exist. */
  resolveBranchCommitSha(
    branch: string,
  ): RepositoryResultAsync<string | undefined> {
    return this.#request.json(
      `${this.#path}/git/ref/heads/${encodeURIComponent(branch)}`,
      { allowNotFound: true },
    ).andThen((value) =>
      value === undefined
        ? ok(undefined)
        : readNestedStringProperty(
            value,
            ["object", "sha"],
            "GitHub branch response",
          )
    );
  }

  /** Creates a remote branch at one immutable commit. */
  createBranch(input: {
    branch: string;
    commitSha: string;
  }): RepositoryResultAsync<void> {
    return this.#requiredJson(`${this.#path}/git/refs`, {
      method: "POST",
      body: {
        ref: `refs/heads/${input.branch}`,
        sha: input.commitSha,
      },
    }).andThen((created) =>
      readNestedStringProperty(
        created,
        ["object", "sha"],
        "GitHub branch creation response",
      ).andThen((commitSha) =>
        commitSha === input.commitSha
          ? ok(undefined)
          : err(new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              `GitHub created branch ${input.branch} at an unexpected commit.`,
            ))
      )
    );
  }

  /** Atomically appends text-file changes to an existing branch. */
  createCommitOnBranch(input: {
    branch: string;
    expectedHeadCommitSha: string;
    message: string;
    files: GitHubFileChange[];
  }): RepositoryResultAsync<string> {
    const additions = input.files
      .filter((file): file is { path: string; content: string } =>
        file.content !== null
      )
      .map((file) => ({
        path: file.path,
        contents: Buffer.from(file.content, "utf8").toString("base64"),
      }));
    const deletions = input.files
      .filter((file) => file.content === null)
      .map((file) => ({ path: file.path }));
    const query = `
      mutation CreateDocumentationCommit($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
          commit {
            oid
          }
        }
      }
    `;

    return this.#request.graphql(query, {
      input: {
        branch: {
          repositoryNameWithOwner:
            `${this.#repository.owner}/${this.#repository.name}`,
          branchName: input.branch,
        },
        expectedHeadOid: input.expectedHeadCommitSha,
        message: { headline: input.message },
        fileChanges: { additions, deletions },
      },
    }).andThen((value) =>
      readNestedStringProperty(
        value,
        ["data", "createCommitOnBranch", "commit", "oid"],
        "GitHub commit creation response",
      )
    );
  }

  /** Reads the parent, message, and changed paths for one remote commit. */
  readCommitDetails(
    commitSha: string,
  ): RepositoryResultAsync<GitHubCommitDetails> {
    return this.#requiredJson(
      `${this.#path}/commits/${encodeURIComponent(commitSha)}?per_page=100`,
    ).andThen((value) => {
      if (typeof value !== "object" || value === null) {
        return err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          "GitHub commit response is invalid.",
        ));
      }
      const record = value as Record<string, unknown>;
      const commit = record.commit;
      const parents = record.parents;
      const files = record.files;
      if (
        typeof commit !== "object" ||
        commit === null ||
        !Array.isArray(parents) ||
        parents.length !== 1 ||
        !Array.isArray(files)
      ) {
        return err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          "GitHub commit response is incomplete.",
        ));
      }
      const message = readStringProperty(
        commit,
        "message",
        "GitHub commit response",
      );
      const parentSha = readStringProperty(
        parents[0],
        "sha",
        "GitHub commit parent",
      );
      if (message.isErr()) return err(message.error);
      if (parentSha.isErr()) return err(parentSha.error);

      const parsedFiles: GitHubCommitFile[] = [];
      for (const file of files) {
        const path = readStringProperty(
          file,
          "filename",
          "GitHub commit file",
        );
        const status = readStringProperty(
          file,
          "status",
          "GitHub commit file",
        );
        if (path.isErr()) return err(path.error);
        if (status.isErr()) return err(status.error);
        if (
          status.value !== "added" &&
          status.value !== "modified" &&
          status.value !== "removed" &&
          status.value !== "renamed"
        ) {
          return err(new RepositoryError(
            "REPOSITORY_GITHUB_FAILED",
            `GitHub commit contains unsupported file status ${status.value}.`,
          ));
        }
        if (status.value === "renamed") {
          const previousPath = readStringProperty(
            file,
            "previous_filename",
            "GitHub renamed commit file",
          );
          if (previousPath.isErr()) return err(previousPath.error);
          parsedFiles.push({
            path: path.value,
            previousPath: previousPath.value,
            status: status.value,
          });
        } else {
          parsedFiles.push({ path: path.value, status: status.value });
        }
      }
      return ok({
        message: message.value,
        parentSha: parentSha.value,
        files: parsedFiles,
      });
    });
  }

  /** Reads one UTF-8 file from an immutable remote commit. */
  readTextFile(input: {
    commitSha: string;
    path: string;
  }): RepositoryResultAsync<string> {
    const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
    const query = new URLSearchParams({ ref: input.commitSha });
    return this.#requiredJson(
      `${this.#path}/contents/${encodedPath}?${query.toString()}`,
    ).andThen((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub file response is invalid: ${input.path}`,
        ));
      }
      const type = readStringProperty(value, "type", "GitHub file response");
      const encoding = readStringProperty(
        value,
        "encoding",
        "GitHub file response",
      );
      const content = readStringProperty(
        value,
        "content",
        "GitHub file response",
        { allowEmpty: true },
      );
      if (type.isErr()) return err(type.error);
      if (encoding.isErr()) return err(encoding.error);
      if (content.isErr()) return err(content.error);
      if (type.value !== "file" || encoding.value !== "base64") {
        return err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub file response is not base64 text: ${input.path}`,
        ));
      }
      try {
        const bytes = Buffer.from(
          content.value.replaceAll(/\s/gu, ""),
          "base64",
        );
        return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (cause) {
        return err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          `GitHub file is not valid UTF-8 text: ${input.path}`,
          { cause },
        ));
      }
    });
  }

  /** Creates or reuses the open draft pull request for an approved branch. */
  createOrReuseDraftPullRequest(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): RepositoryResultAsync<{
    number: number;
    url: string;
    draft: true;
    reused: boolean;
  }> {
    return this.findDraftPullRequest(input).andThen((existing) => {
      if (existing !== undefined) {
        return ok({ ...existing, reused: true });
      }
      return this.#requiredJson(`${this.#path}/pulls`, {
        method: "POST",
        body: {
          title: input.title,
          head: input.branch,
          base: input.baseBranch,
          body: input.body,
          draft: true,
        },
      }).andThen((created) =>
        Result.combine([
          readNumberProperty(created, "number", "GitHub pull request response"),
          readStringProperty(
            created,
            "html_url",
            "GitHub pull request response",
          ),
          readBooleanProperty(
            created,
            "draft",
            "GitHub pull request response",
          ),
        ]).andThen(([number, url, draft]) =>
          draft
            ? ok({ number, url, draft: true as const, reused: false })
            : err(new RepositoryError(
                "REPOSITORY_GITHUB_FAILED",
                "GitHub created a pull request that was not a draft.",
              ))
        )
      );
    });
  }

  /** Finds the existing open draft pull request for one approved branch. */
  findDraftPullRequest(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): RepositoryResultAsync<{
    number: number;
    url: string;
    draft: true;
  } | undefined> {
    const query = new URLSearchParams({
      state: "open",
      head: `${this.#repository.owner}:${input.branch}`,
      base: input.baseBranch,
      per_page: "10",
    });

    return this.#requiredJson(
      `${this.#path}/pulls?${query.toString()}`,
    ).andThen((value) => {
      if (!Array.isArray(value)) {
        return err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          "GitHub pull request search returned an invalid response.",
        ));
      }
      const existing = value[0];
      if (existing === undefined) return ok(undefined);
      return Result.combine([
        readNumberProperty(existing, "number", "GitHub pull request response"),
        readStringProperty(
          existing,
          "html_url",
          "GitHub pull request response",
        ),
        readStringProperty(existing, "title", "GitHub pull request response"),
        readNullableStringProperty(
          existing,
          "body",
          "GitHub pull request response",
        ),
        readBooleanProperty(existing, "draft", "GitHub pull request response"),
      ]).andThen(([number, url, title, body, draft]) => {
        if (title !== input.title || body !== input.body || draft !== true) {
          return err(new RepositoryError(
            "REPOSITORY_CONFLICT",
            `An open pull request already exists for ${input.branch} with different approved metadata.`,
          ));
        }
        return ok({ number, url, draft: true as const });
      });
    });
  }

  #requiredJson(
    path: string,
    options?: GitHubRequestOptions,
  ): RepositoryResultAsync<unknown> {
    return this.#request.json(path, options).andThen((value) =>
      value === undefined
        ? err(new RepositoryError(
            "REPOSITORY_GITHUB_FAILED",
            `GitHub resource was not found: ${path}`,
          ))
        : ok(value)
    );
  }
}

function normalizeRequestedRef(value: string): RepositoryResult<string> {
  const ref = value.trim();
  return ref.length === 0
    ? err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        "Repository ref must not be empty.",
      ))
    : ok(ref);
}

function githubJson(
  path: string,
  token: string,
  abortSignal: AbortSignal,
  options: GitHubRequestOptions = {},
): RepositoryResultAsync<unknown | undefined> {
  return githubFetch(path, token, abortSignal, options).andThen((response) =>
    response === undefined
      ? ok(undefined)
      : ResultAsync.fromPromise(
          response.json(),
          (cause) =>
            new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              `GitHub returned invalid JSON: ${path}`,
              { cause },
            ),
        )
  );
}

function githubGraphql(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  abortSignal: AbortSignal,
): RepositoryResultAsync<unknown> {
  const path = "/graphql";
  return githubFetch(path, token, abortSignal, {
    method: "POST",
    body: { query, variables },
  }).andThen((response) =>
    response === undefined
      ? err(new RepositoryError(
          "REPOSITORY_GITHUB_FAILED",
          "GitHub GraphQL response was missing.",
        ))
      : ResultAsync.fromPromise(
          response.json(),
          (cause) =>
            new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              "GitHub returned invalid GraphQL JSON.",
              { cause },
            ),
        ).andThen((value) => {
          if (
            typeof value === "object" &&
            value !== null &&
            Array.isArray((value as { errors?: unknown }).errors) &&
            (value as { errors: unknown[] }).errors.length > 0
          ) {
            return err(new RepositoryError(
              "REPOSITORY_GITHUB_FAILED",
              "GitHub rejected the documentation commit.",
            ));
          }
          return ok(value);
        })
  );
}

function githubFetch(
  path: string,
  token: string,
  abortSignal: AbortSignal,
  options: GitHubRequestOptions = {},
): RepositoryResultAsync<Response | undefined> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
  };
  headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const request = fetch(`https://api.github.com${path}`, {
    headers,
    method: options.method,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: abortSignal,
  }).then(
    (response) =>
      options.allowNotFound && response.status === 404
        ? ok(undefined)
        : response.ok
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
  options: { allowEmpty?: boolean } = {},
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
  if (
    typeof result !== "string" ||
    (!options.allowEmpty && result.length === 0)
  ) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ),
    );
  }
  return ok(result);
}

function readNestedStringProperty(
  value: unknown,
  properties: string[],
  label: string,
): RepositoryResult<string> {
  let current = value;
  for (const property of properties) {
    if (
      typeof current !== "object" ||
      current === null ||
      !(property in current)
    ) {
      return err(new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} is missing ${properties.join(".")}.`,
      ));
    }
    current = (current as Record<string, unknown>)[property];
  }
  return typeof current === "string" && current.length > 0
    ? ok(current)
    : err(new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${properties.join(".")}.`,
      ));
}

function readNullableStringProperty(
  value: unknown,
  property: string,
  label: string,
): RepositoryResult<string> {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return err(new RepositoryError(
      "REPOSITORY_GITHUB_FAILED",
      `${label} is missing ${property}.`,
    ));
  }
  const result = (value as Record<string, unknown>)[property];
  return result === null
    ? ok("")
    : typeof result === "string"
    ? ok(result)
    : err(new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ));
}

function readNumberProperty(
  value: unknown,
  property: string,
  label: string,
): RepositoryResult<number> {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return err(new RepositoryError(
      "REPOSITORY_GITHUB_FAILED",
      `${label} is missing ${property}.`,
    ));
  }
  const result = (value as Record<string, unknown>)[property];
  return typeof result === "number" && Number.isSafeInteger(result)
    ? ok(result)
    : err(new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ));
}

function readBooleanProperty(
  value: unknown,
  property: string,
  label: string,
): RepositoryResult<boolean> {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} is missing ${property}.`,
      ),
    );
  }
  const result = (value as Record<string, unknown>)[property];
  if (typeof result !== "boolean") {
    return err(
      new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} has an invalid ${property}.`,
      ),
    );
  }
  return ok(result);
}
