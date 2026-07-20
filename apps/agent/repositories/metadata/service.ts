import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";
import { z } from "zod";

import {
  resolveConfiguredRepository,
} from "../config";
import { resolveRepositoryCatalog } from "../configuration/resolver";
import {
  resolveRepositoryGitHubAccess,
  resolveGitHubToken,
} from "../shared/github";
import { RepositoryError } from "../shared/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "../shared/errors";
import type { RepositoryConfig } from "../types";
import type {
  RepositoryCommitSummary,
  RepositoryIssue,
  RepositoryMetadataQuery,
  RepositoryRelease,
  RepositoryTag,
} from "./types";

export const MAX_REPOSITORY_METADATA_LIMIT = 100;

const releaseSchema = z.object({
  id: z.number().int(),
  tag_name: z.string().min(1),
  name: z.string().nullable(),
  published_at: z.string().nullable(),
  html_url: z.string().min(1),
  draft: z.boolean(),
  prerelease: z.boolean(),
});

const issueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.literal("open"),
  html_url: z.string().min(1),
  labels: z.array(z.union([
    z.string(),
    z.object({ name: z.string() }),
  ])),
  created_at: z.string(),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
});

const tagSchema = z.object({
  name: z.string().min(1),
  commit: z.object({ sha: z.string().min(1) }),
});

const commitSchema = z.object({
  sha: z.string().min(1),
  html_url: z.string().min(1),
  commit: z.object({
    message: z.string(),
    author: z.object({
      date: z.string(),
    }).nullable(),
  }),
});

/** Contract for bounded GitHub metadata reads in the trusted app runtime. */
export interface RepositoryMetadataService {
  listReleases(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryRelease[]>;
  listOpenIssues(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryIssue[]>;
  listTags(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryTag[]>;
  listCommits(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryCommitSummary[]>;
}

interface GitHubRepositoryMetadataServiceOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;
}

/**
 * Reads configured repository metadata directly from GitHub.
 *
 * This service intentionally has no sandbox dependency. GitHub credentials and
 * HTTP calls stay in the trusted app runtime, and only parsed metadata is
 * returned to the model-facing tool.
 */
export class GitHubRepositoryMetadataService
  implements RepositoryMetadataService {
  readonly #ctx: ToolContext;
  readonly #repositories?: RepositoryConfig[];
  readonly #getGitHubToken: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: GitHubRepositoryMetadataServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  listReleases(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryRelease[]> {
    return this.#list(input, "releases", input.limit, (value) =>
      parseArray(value, releaseSchema, "GitHub releases response").map(
        (releases) =>
          releases
            .slice(0, input.limit)
            .map((release) => ({
              id: release.id,
              tagName: release.tag_name,
              name: release.name,
              publishedAt: release.published_at,
              url: release.html_url,
              draft: release.draft,
              prerelease: release.prerelease,
            })),
      )
    );
  }

  listOpenIssues(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryIssue[]> {
    // GitHub mixes pull requests into the issues endpoint. Read one bounded
    // page, remove pull requests, and only then apply the caller's result cap.
    return this.#list(
      input,
      "issues",
      MAX_REPOSITORY_METADATA_LIMIT,
      (value) =>
        parseArray(value, issueSchema, "GitHub issues response").map(
          (issues) =>
            issues
              .filter((issue) => issue.pull_request === undefined)
              .slice(0, input.limit)
              .map((issue) => ({
                number: issue.number,
                title: issue.title,
                state: issue.state,
                url: issue.html_url,
                labels: issue.labels.map((label) =>
                  typeof label === "string" ? label : label.name
                ),
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
              })),
        ),
      {
        filter: "all",
        state: "open",
        sort: "updated",
        direction: "desc",
      },
    );
  }

  listTags(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryTag[]> {
    return this.#list(input, "tags", input.limit, (value) =>
      parseArray(value, tagSchema, "GitHub tags response").map((tags) =>
        tags
          .slice(0, input.limit)
          .map((tag) => ({
            name: tag.name,
            commitSha: tag.commit.sha,
          }))
      )
    );
  }

  listCommits(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryCommitSummary[]> {
    return this.#list(input, "commits", input.limit, (value) =>
      parseArray(value, commitSchema, "GitHub commits response").map(
        (commits) =>
          commits
            .slice(0, input.limit)
            .map((commit) => ({
              sha: commit.sha,
              message: commit.commit.message,
              authoredAt: commit.commit.author?.date ?? null,
              url: commit.html_url,
            })),
      )
    );
  }

  #list<T>(
    input: RepositoryMetadataQuery,
    resource: string,
    perPage: number,
    parse: (value: unknown) => RepositoryResult<T[]>,
    parameters: Record<string, string> = {},
  ): RepositoryResultAsync<T[]> {
    return this.#catalog().andThen((repositories) =>
      Result.combine([
        assertMetadataLimit(input.limit),
        resolveConfiguredRepository(repositories, input.repositoryId),
      ]).asyncAndThen(([, repository]) =>
        resolveRepositoryGitHubAccess(
          repository,
          this.#ctx.abortSignal,
          this.#getGitHubToken,
        ).andThen(({ request }) => {
          const query = new URLSearchParams({
            ...parameters,
            per_page: String(perPage),
          });
          const path =
            `/repos/${encodeURIComponent(repository.owner)}` +
            `/${encodeURIComponent(repository.name)}/${resource}` +
            `?${query.toString()}`;
          return request.json(path).andThen((value) =>
            value === undefined
              ? err(new RepositoryError(
                  "REPOSITORY_GITHUB_FAILED",
                  `GitHub metadata resource was not found: ${path}`,
                ))
              : parse(value)
          );
        })
      )
    );
  }

  #catalog(): RepositoryResultAsync<RepositoryConfig[]> {
    return this.#repositories === undefined
      ? resolveRepositoryCatalog()
      : new ResultAsync(Promise.resolve(ok(this.#repositories)));
  }
}

function assertMetadataLimit(limit: number): RepositoryResult<number> {
  return Number.isSafeInteger(limit) &&
      limit >= 1 &&
      limit <= MAX_REPOSITORY_METADATA_LIMIT
    ? ok(limit)
    : err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        `Repository metadata limit must be between 1 and ${MAX_REPOSITORY_METADATA_LIMIT}.`,
      ));
}

function parseArray<T extends z.ZodType>(
  value: unknown,
  schema: T,
  label: string,
): RepositoryResult<Array<z.output<T>>> {
  const parsed = z.array(schema).safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(new RepositoryError(
        "REPOSITORY_GITHUB_FAILED",
        `${label} is invalid.`,
        { cause: parsed.error },
      ));
}
