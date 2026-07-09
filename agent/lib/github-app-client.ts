import { getTokenResponse, type ConnectTokenResponse } from "@vercel/connect";

export type { ConnectTokenResponse };

export const GITHUB_CONNECTOR_ENV = "DOCS_AGENT_GITHUB_CONNECTOR";
export const GITHUB_API_VERSION = "2022-11-28";

export interface GitHubRepositorySlug {
  owner: string;
  repo: string;
}

export type GitHubApiErrorResult = {
  ok: false;
  status: number;
  message: string;
};

export type GitHubApiResult<T> =
  | {
      ok: true;
      status: number;
      body: T;
    }
  | GitHubApiErrorResult;

export function resolveGitHubConnector(
  state?: { githubWriteback?: { connector?: string } } | null,
): string {
  return (
    process.env[GITHUB_CONNECTOR_ENV]?.trim() ||
    state?.githubWriteback?.connector?.trim() ||
    ""
  );
}

export async function resolveGitHubAppInstallationToken(input: {
  connector: string;
  slug: GitHubRepositorySlug;
}): Promise<ConnectTokenResponse> {
  return getTokenResponse(
    input.connector,
    {
      subject: { type: "app" },
      authorizationDetails: [
        {
          type: "github_app_installation",
          org: input.slug.owner,
          repositories: [input.slug.repo],
        },
      ],
    },
    { forceRefresh: true },
  );
}

export async function githubApiRequest<T>(input: {
  token?: string;
  method?: "GET" | "POST";
  path: string;
  abortSignal?: AbortSignal;
  body?: unknown;
}): Promise<GitHubApiResult<T>> {
  const response = await fetch(`https://api.github.com${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "docs-agent",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(input.token === undefined ? {} : { Authorization: `Bearer ${input.token}` }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.abortSignal,
  });

  const text = await response.text();
  const body = parseJsonOrNull(text);
  if (response.ok) {
    return { ok: true, status: response.status, body: body as T };
  }

  return {
    ok: false,
    status: response.status,
    message: isGitHubErrorBody(body)
      ? body.message
      : text.trim() || `GitHub API returned ${response.status}.`,
  };
}

export function parseGitHubRepositoryUrl(url: string): GitHubRepositorySlug {
  const parsed = new URL(url);
  const parts = parsed.pathname
    .replace(/^\/+/, "")
    .replace(/\.git$/, "")
    .split("/");
  const [owner, repo] = parts;

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parts.length !== 2 ||
    !owner ||
    !repo
  ) {
    throw new Error(`Unsupported GitHub repository URL: ${url}`);
  }

  return { owner, repo };
}

export function gitHubWritebackPermissions(response: ConnectTokenResponse): {
  contents?: string;
  pull_requests?: string;
} {
  const permissions = response.metadata?.permissions;
  if (!isRecord(permissions)) return {};

  return {
    contents: stringValue(permissions.contents),
    pull_requests: stringValue(permissions.pull_requests),
  };
}

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonOrNull(text: string): unknown {
  if (text.trim() === "") return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isGitHubErrorBody(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
