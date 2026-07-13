import { z } from "zod";

import {
  githubApiRequest,
  type GitHubApiResult,
  type GitHubRepositorySlug,
} from "./github-app-client";

const gitObjectSchema = z.object({
  sha: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

const githubRefResponseSchema = z.object({
  ref: z.string().trim().min(1),
  object: gitObjectSchema,
});

const githubGitCommitResponseSchema = z.object({
  sha: z.string().trim().min(1),
  tree: z.object({
    sha: z.string().trim().min(1),
  }),
});

const githubTreeResponseSchema = z.object({
  sha: z.string().trim().min(1),
});

const githubPullResponseSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().url(),
  draft: z.boolean().optional(),
});

export type ChangedFileEntry = {
  path: string;
  mode: "100644" | "100755";
  content: string;
  contentBase64?: never;
  deleted?: never;
} | {
  path: string;
  mode: "100644" | "100755";
  contentBase64: string;
  content?: never;
  deleted?: never;
} | {
  path: string;
  mode: "100644" | "100755";
  deleted: true;
  content?: never;
  contentBase64?: never;
};

export interface GitHubDraftPullRequestResult {
  treeSha: string;
  commitSha: string;
  pullRequest: {
    number: number;
    url: string;
    draft: boolean;
  };
}

export interface GitHubWritebackClient {
  publishDraftPullRequest(input: {
    token: string;
    slug: GitHubRepositorySlug;
    baseBranch: string;
    baseSha: string;
    branchName: string;
    commitMessage: string;
    title: string;
    body: string;
    changedFiles: ChangedFileEntry[];
    abortSignal: AbortSignal;
  }): Promise<GitHubDraftPullRequestResult>;
}

type GitHubRequestInput = {
  token: string;
  method: "GET" | "POST";
  path: string;
  abortSignal: AbortSignal;
  body?: unknown;
};

export type GitHubWritebackTransport = (
  input: GitHubRequestInput,
) => Promise<GitHubApiResult<unknown>>;

export class GitHubWritebackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubWritebackError";
  }
}

const defaultTransport: GitHubWritebackTransport = (input) =>
  githubApiRequest<unknown>(input);

export function createGitHubWritebackClient(
  transport: GitHubWritebackTransport = defaultTransport,
): GitHubWritebackClient {
  return {
    async publishDraftPullRequest(input) {
      const repositoryPath =
        `/repos/${encodePathPart(input.slug.owner)}/${encodePathPart(input.slug.repo)}`;
      const baseRef = await requestOrNull(
        transport,
        githubRefResponseSchema,
        {
          token: input.token,
          method: "GET",
          path: `${repositoryPath}/git/ref/heads/${encodeGitRefPath(input.baseBranch)}`,
          abortSignal: input.abortSignal,
        },
      );

      if (baseRef === null) {
        throw new GitHubWritebackError(
          `Base branch does not exist on GitHub: ${input.baseBranch}.`,
        );
      }

      if (baseRef.object.sha !== input.baseSha) {
        throw new GitHubWritebackError(
          `Base branch moved since the sandbox workflow ran. Expected ${input.baseSha}, found ${baseRef.object.sha}. Re-run the workflow before publishing.`,
        );
      }

      const baseCommit = await request(
        transport,
        githubGitCommitResponseSchema,
        {
          token: input.token,
          method: "GET",
          path: `${repositoryPath}/git/commits/${encodePathPart(input.baseSha)}`,
          abortSignal: input.abortSignal,
        },
      );

      const treeEntries = [];
      for (const file of input.changedFiles) {
        if (file.deleted) {
          treeEntries.push({ path: file.path, mode: file.mode, type: "blob", sha: null });
        } else if (file.contentBase64 !== undefined) {
          const blob = await request(
            transport,
            githubTreeResponseSchema,
            {
              token: input.token,
              method: "POST",
              path: `${repositoryPath}/git/blobs`,
              abortSignal: input.abortSignal,
              body: { content: file.contentBase64, encoding: "base64" },
            },
          );
          treeEntries.push({
            path: file.path,
            mode: file.mode,
            type: "blob",
            sha: blob.sha,
          });
        } else {
          treeEntries.push({
            path: file.path,
            mode: file.mode,
            type: "blob",
            content: file.content,
          });
        }
      }

      const tree = await request(
        transport,
        githubTreeResponseSchema,
        {
          token: input.token,
          method: "POST",
          path: `${repositoryPath}/git/trees`,
          abortSignal: input.abortSignal,
          body: {
            base_tree: baseCommit.tree.sha,
            tree: treeEntries,
          },
        },
      );

      const branchPath =
        `${repositoryPath}/git/ref/heads/${encodeGitRefPath(input.branchName)}`;
      const existingBranch = await requestOrNull(
        transport,
        githubRefResponseSchema,
        {
          token: input.token,
          method: "GET",
          path: branchPath,
          abortSignal: input.abortSignal,
        },
      );

      if (existingBranch !== null) {
        const existingCommit = await request(
          transport,
          githubGitCommitResponseSchema,
          {
            token: input.token,
            method: "GET",
            path: `${repositoryPath}/git/commits/${encodePathPart(existingBranch.object.sha)}`,
            abortSignal: input.abortSignal,
          },
        );

        if (existingCommit.tree.sha !== tree.sha) {
          throw new GitHubWritebackError(
            `Branch already exists on GitHub with different content: ${input.branchName}.`,
          );
        }

        const existingPullRequest = await findExistingPullRequest(
          transport,
          repositoryPath,
          input,
        );

        if (existingPullRequest !== null) {
          return {
            treeSha: existingCommit.tree.sha,
            commitSha: existingBranch.object.sha,
            pullRequest: normalizePullResponse(existingPullRequest),
          };
        }

        const pullRequest = await createPullRequest(
          transport,
          repositoryPath,
          input,
        );

        return {
          treeSha: existingCommit.tree.sha,
          commitSha: existingBranch.object.sha,
          pullRequest: normalizePullResponse(pullRequest),
        };
      }

      const commit = await request(
        transport,
        githubGitCommitResponseSchema,
        {
          token: input.token,
          method: "POST",
          path: `${repositoryPath}/git/commits`,
          abortSignal: input.abortSignal,
          body: {
            message: input.commitMessage,
            tree: tree.sha,
            parents: [input.baseSha],
          },
        },
      );

      await request(
        transport,
        githubRefResponseSchema,
        {
          token: input.token,
          method: "POST",
          path: `${repositoryPath}/git/refs`,
          abortSignal: input.abortSignal,
          body: {
            ref: `refs/heads/${input.branchName}`,
            sha: commit.sha,
          },
        },
      );

      const pullRequest = await createPullRequest(
        transport,
        repositoryPath,
        input,
      );

      return {
        treeSha: tree.sha,
        commitSha: commit.sha,
        pullRequest: normalizePullResponse(pullRequest),
      };
    },
  };
}

async function findExistingPullRequest(
  transport: GitHubWritebackTransport,
  repositoryPath: string,
  input: Parameters<GitHubWritebackClient["publishDraftPullRequest"]>[0],
): Promise<z.infer<typeof githubPullResponseSchema> | null> {
  const pulls = await request(
    transport,
    z.array(githubPullResponseSchema),
    {
      token: input.token,
      method: "GET",
      path:
        `${repositoryPath}/pulls` +
        `?state=open&head=${encodeURIComponent(`${input.slug.owner}:${input.branchName}`)}` +
        `&base=${encodeURIComponent(input.baseBranch)}&per_page=10`,
      abortSignal: input.abortSignal,
    },
  );

  return pulls[0] ?? null;
}

async function createPullRequest(
  transport: GitHubWritebackTransport,
  repositoryPath: string,
  input: Parameters<GitHubWritebackClient["publishDraftPullRequest"]>[0],
): Promise<z.infer<typeof githubPullResponseSchema>> {
  return request(
    transport,
    githubPullResponseSchema,
    {
      token: input.token,
      method: "POST",
      path: `${repositoryPath}/pulls`,
      abortSignal: input.abortSignal,
      body: {
        title: input.title,
        body: input.body,
        head: input.branchName,
        base: input.baseBranch,
        draft: true,
      },
    },
  );
}

function normalizePullResponse(
  pullRequest: z.infer<typeof githubPullResponseSchema>,
): GitHubDraftPullRequestResult["pullRequest"] {
  return {
    number: pullRequest.number,
    url: pullRequest.html_url,
    draft: pullRequest.draft ?? true,
  };
}

async function request<T>(
  transport: GitHubWritebackTransport,
  schema: z.ZodType<T>,
  input: GitHubRequestInput,
): Promise<T> {
  const result = await transport(input);
  if (!result.ok) {
    throw new GitHubWritebackError(
      `GitHub ${input.method} ${input.path} failed with ${result.status}: ${truncateOneLine(result.message, 1_000)}`,
    );
  }

  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
      .join("; ");
    throw new GitHubWritebackError(
      `GitHub ${input.method} ${input.path} returned a malformed response: ${truncateOneLine(issues, 1_000)}`,
    );
  }

  return parsed.data;
}

async function requestOrNull<T>(
  transport: GitHubWritebackTransport,
  schema: z.ZodType<T>,
  input: GitHubRequestInput,
): Promise<T | null> {
  const result = await transport(input);
  if (!result.ok && result.status === 404) return null;
  if (!result.ok) {
    throw new GitHubWritebackError(
      `GitHub ${input.method} ${input.path} failed with ${result.status}: ${truncateOneLine(result.message, 1_000)}`,
    );
  }

  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
      .join("; ");
    throw new GitHubWritebackError(
      `GitHub ${input.method} ${input.path} returned a malformed response: ${truncateOneLine(issues, 1_000)}`,
    );
  }

  return parsed.data;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function encodeGitRefPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function truncateOneLine(value: string, maxLength: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return oneLine.slice(0, maxLength - 1).trimEnd();
}
