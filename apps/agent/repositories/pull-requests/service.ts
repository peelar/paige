import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";
import { z } from "zod";

import { resolveConfiguredRepository } from "../config";
import { RepositoryService } from "../service";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "../shared/errors";
import { RepositoryError } from "../shared/errors";
import {
  resolveRepositoryGitHubAccess,
  resolveGitHubToken,
} from "../shared/github";
import type { RepositoryConfig } from "../types";
import type {
  PullRequestComment,
  PullRequestCommentKind,
  PullRequestConversationComment,
  PullRequestDetails,
  PullRequestFile,
  PullRequestInlineComment,
  PullRequestListState,
  PullRequestPage,
  PullRequestReview,
  PullRequestSummary,
} from "./types";

export const MAX_PULL_REQUEST_READ_LIMIT = 50;

const userSchema = z.object({ login: z.string().min(1) }).nullable();

const pullRequestSummarySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  html_url: z.string().min(1),
  draft: z.boolean(),
  user: userSchema,
  head: z.object({
    sha: z.string().min(1),
    ref: z.string().min(1),
  }),
  base: z.object({
    sha: z.string().min(1),
    ref: z.string().min(1),
  }),
  created_at: z.string(),
  updated_at: z.string(),
});

const pullRequestDetailsSchema = pullRequestSummarySchema.extend({
  body: z.string().nullable(),
  closed_at: z.string().nullable(),
  merged_at: z.string().nullable(),
  author_association: z.string(),
  labels: z.array(z.union([
    z.string(),
    z.object({ name: z.string() }),
  ])),
  requested_reviewers: z.array(z.object({ login: z.string().min(1) })),
  commits: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  review_comments: z.number().int().nonnegative(),
});

const pullRequestFileSchema = z.object({
  filename: z.string().min(1),
  previous_filename: z.string().min(1).optional(),
  status: z.enum([
    "added",
    "removed",
    "modified",
    "renamed",
    "copied",
    "changed",
    "unchanged",
  ]),
  sha: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
});

const conversationCommentSchema = z.object({
  id: z.number().int().positive(),
  user: userSchema,
  author_association: z.string(),
  body: z.string().nullable(),
  html_url: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
});

const reviewSchema = z.object({
  id: z.number().int().positive(),
  user: userSchema,
  author_association: z.string(),
  body: z.string().nullable(),
  html_url: z.string().min(1),
  state: z.string().min(1),
  submitted_at: z.string().nullable().optional(),
  commit_id: z.string().min(1),
});

const inlineCommentSchema = z.object({
  id: z.number().int().positive(),
  user: userSchema,
  author_association: z.string(),
  body: z.string().nullable(),
  html_url: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
  path: z.string().min(1),
  line: z.number().int().nullable().optional(),
  start_line: z.number().int().nullable().optional(),
  side: z.string().nullable().optional(),
  start_side: z.string().nullable().optional(),
  original_line: z.number().int().nullable().optional(),
  commit_id: z.string().min(1),
  original_commit_id: z.string().min(1),
  in_reply_to_id: z.number().int().positive().optional(),
});

interface PullRequestReadServiceOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;
}

/** Reads pull-request resources without acquiring or changing a sandbox. */
export class PullRequestReadService {
  readonly #ctx: ToolContext;
  readonly #repositories?: RepositoryConfig[];
  readonly #getGitHubToken: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: PullRequestReadServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories;
    this.#getGitHubToken = options.getGitHubToken ?? resolveGitHubToken;
  }

  list(input: {
    repositoryId: string;
    state: PullRequestListState;
    page: number;
    limit: number;
  }): RepositoryResultAsync<PullRequestPage<PullRequestSummary>> {
    return this.#listPage(
      input,
      "pulls",
      pullRequestSummarySchema,
      (pullRequest) => summarizePullRequest(pullRequest),
      {
        state: input.state,
        sort: "updated",
        direction: "desc",
      },
      "GitHub pull requests response",
    );
  }

  read(input: {
    repositoryId: string;
    pullRequestNumber: number;
  }): RepositoryResultAsync<PullRequestDetails> {
    return assertPullRequestNumber(input.pullRequestNumber).asyncAndThen(
      (pullRequestNumber) =>
        this.#request(
          input.repositoryId,
          `pulls/${pullRequestNumber}`,
          (value) =>
            parseValue(
              value,
              pullRequestDetailsSchema,
              "GitHub pull request response",
            ).map((pullRequest) => ({
              ...summarizePullRequest(pullRequest),
              body: pullRequest.body,
              headRef: pullRequest.head.ref,
              merged: pullRequest.merged_at !== null,
              closedAt: pullRequest.closed_at,
              mergedAt: pullRequest.merged_at,
              authorAssociation: pullRequest.author_association,
              labels: pullRequest.labels.map((label) =>
                typeof label === "string" ? label : label.name
              ),
              requestedReviewers: pullRequest.requested_reviewers.map(
                (reviewer) => reviewer.login,
              ),
              commitCount: pullRequest.commits,
              changedFileCount: pullRequest.changed_files,
              additions: pullRequest.additions,
              deletions: pullRequest.deletions,
              conversationCommentCount: pullRequest.comments,
              inlineCommentCount: pullRequest.review_comments,
            })),
        ),
    );
  }

  listFiles(input: {
    repositoryId: string;
    pullRequestNumber: number;
    page: number;
    limit: number;
  }): RepositoryResultAsync<PullRequestPage<PullRequestFile>> {
    return assertPullRequestNumber(input.pullRequestNumber).asyncAndThen(
      (pullRequestNumber) =>
        this.#listPage(
          input,
          `pulls/${pullRequestNumber}/files`,
          pullRequestFileSchema,
          (file) => ({
            path: file.filename,
            previousPath: file.previous_filename ?? null,
            status: file.status,
            blobSha: file.sha,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
          }),
          {},
          "GitHub pull request files response",
        ),
    );
  }

  listComments(input: {
    repositoryId: string;
    pullRequestNumber: number;
    commentKind: PullRequestCommentKind;
    page: number;
    limit: number;
  }): RepositoryResultAsync<PullRequestPage<PullRequestComment>> {
    return assertPullRequestNumber(input.pullRequestNumber).asyncAndThen(
      (pullRequestNumber) => {
        switch (input.commentKind) {
          case "conversation":
            return this.#listPage(
              input,
              `issues/${pullRequestNumber}/comments`,
              conversationCommentSchema,
              (comment): PullRequestComment => conversationComment(comment),
              {},
              "GitHub pull request conversation comments response",
            );
          case "review":
            return this.#listPage(
              input,
              `pulls/${pullRequestNumber}/reviews`,
              reviewSchema,
              (review): PullRequestComment => reviewComment(review),
              {},
              "GitHub pull request reviews response",
            );
          case "inline":
            return this.#listPage(
              input,
              `pulls/${pullRequestNumber}/comments`,
              inlineCommentSchema,
              (comment): PullRequestComment => inlineComment(comment),
              {},
              "GitHub pull request inline comments response",
            );
        }
      },
    );
  }

  #listPage<TSchema extends z.ZodType, TOutput>(
    input: { repositoryId: string; page: number; limit: number },
    resource: string,
    schema: TSchema,
    map: (value: z.output<TSchema>) => TOutput,
    parameters: Record<string, string>,
    label: string,
  ): RepositoryResultAsync<PullRequestPage<TOutput>> {
    return Result.combine([
      assertPage(input.page),
      assertLimit(input.limit),
    ]).asyncAndThen(([page, limit]) => {
      const query = new URLSearchParams({
        ...parameters,
        page: String(page),
        per_page: String(limit + 1),
      });
      return this.#request(
        input.repositoryId,
        `${resource}?${query.toString()}`,
        (value) =>
          parseArray(value, schema, label).map((items) => ({
            items: items.slice(0, limit).map(map),
            page,
            nextPage: items.length > limit ? page + 1 : null,
          })),
      );
    });
  }

  #request<T>(
    repositoryId: string,
    resource: string,
    parse: (value: unknown) => RepositoryResult<T>,
  ): RepositoryResultAsync<T> {
    return this.#catalog().andThen((repositories) =>
      resolveConfiguredRepository(repositories, repositoryId).asyncAndThen(
        (repository) =>
          resolveRepositoryGitHubAccess(
            repository,
            this.#ctx.abortSignal,
            this.#getGitHubToken,
          ).andThen(({ request }) => {
            return request.json(repositoryResource(repository, resource))
              .andThen((value) => parse(value));
          }),
      )
    );
  }

  #catalog(): RepositoryResultAsync<RepositoryConfig[]> {
    return this.#repositories === undefined
      ? new RepositoryService(this.#ctx).catalog()
      : new ResultAsync(Promise.resolve(ok(this.#repositories)));
  }
}

function repositoryResource(
  repository: RepositoryConfig,
  resource: string,
): string {
  return `/repos/${encodeURIComponent(repository.owner)}` +
    `/${encodeURIComponent(repository.name)}/${resource}`;
}

function summarizePullRequest(
  pullRequest: z.output<typeof pullRequestSummarySchema>,
): PullRequestSummary {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    url: pullRequest.html_url,
    draft: pullRequest.draft,
    author: pullRequest.user?.login ?? null,
    headCommitSha: pullRequest.head.sha,
    baseCommitSha: pullRequest.base.sha,
    baseRef: pullRequest.base.ref,
    createdAt: pullRequest.created_at,
    updatedAt: pullRequest.updated_at,
  };
}

function conversationComment(
  comment: z.output<typeof conversationCommentSchema>,
): PullRequestConversationComment {
  return {
    kind: "conversation",
    id: comment.id,
    author: comment.user?.login ?? null,
    authorAssociation: comment.author_association,
    body: comment.body,
    url: comment.html_url,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
  };
}

function reviewComment(
  review: z.output<typeof reviewSchema>,
): PullRequestReview {
  return {
    kind: "review",
    id: review.id,
    author: review.user?.login ?? null,
    authorAssociation: review.author_association,
    body: review.body,
    url: review.html_url,
    state: review.state,
    submittedAt: review.submitted_at ?? null,
    commitSha: review.commit_id,
  };
}

function inlineComment(
  comment: z.output<typeof inlineCommentSchema>,
): PullRequestInlineComment {
  return {
    kind: "inline",
    id: comment.id,
    author: comment.user?.login ?? null,
    authorAssociation: comment.author_association,
    body: comment.body,
    url: comment.html_url,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    path: comment.path,
    line: comment.line ?? null,
    startLine: comment.start_line ?? null,
    side: comment.side ?? null,
    startSide: comment.start_side ?? null,
    originalLine: comment.original_line ?? null,
    commitSha: comment.commit_id,
    originalCommitSha: comment.original_commit_id,
    inReplyToId: comment.in_reply_to_id ?? null,
  };
}

function assertPullRequestNumber(
  pullRequestNumber: number,
): RepositoryResult<number> {
  return Number.isSafeInteger(pullRequestNumber) && pullRequestNumber > 0
    ? ok(pullRequestNumber)
    : err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Pull request number must be a positive integer.",
    ));
}

function assertPage(page: number): RepositoryResult<number> {
  return Number.isSafeInteger(page) && page > 0
    ? ok(page)
    : err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Pull request page must be a positive integer.",
    ));
}

function assertLimit(limit: number): RepositoryResult<number> {
  return Number.isSafeInteger(limit) &&
      limit >= 1 &&
      limit <= MAX_PULL_REQUEST_READ_LIMIT
    ? ok(limit)
    : err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Pull request limit must be between 1 and ${MAX_PULL_REQUEST_READ_LIMIT}.`,
    ));
}

function parseValue<TSchema extends z.ZodType>(
  value: unknown,
  schema: TSchema,
  label: string,
): RepositoryResult<z.output<TSchema>> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(new RepositoryError(
      "REPOSITORY_GITHUB_FAILED",
      `${label} is invalid.`,
      { cause: parsed.error },
    ));
}

function parseArray<TSchema extends z.ZodType>(
  value: unknown,
  schema: TSchema,
  label: string,
): RepositoryResult<Array<z.output<TSchema>>> {
  return parseValue(value, z.array(schema), label);
}
