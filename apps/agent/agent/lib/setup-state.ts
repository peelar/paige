import type { ToolContext } from "eve/tools";

import {
  DEFAULT_WORKSPACE_ID,
  GITHUB_CONNECTOR_ENV,
  SETUP_STATE_VERSION,
  evaluateSetupState,
  getSetupStatus,
  readSetupState,
  repositoryInputForSetup,
  requireSetupReady,
  resolveGitHubConnector,
  saveGitHubWritebackSetup,
  saveSetupState,
  saveWorkingRepositorySetup,
  setupIssueSchema,
  setupStateSchema,
  setupStatusSchema,
  type ReadySetupState,
  type SetupCapability,
  type SetupIssue,
  type SetupState,
  type SetupStatus,
} from "@docs-agent/control-plane/agent";
import {
  runGitHubWritebackPreflight,
  type GitHubWritebackPreflight,
} from "@docs-agent/control-plane/github-preflight";
import { resolveGitHubAppInstallationToken } from "./github-app-client";

export {
  DEFAULT_WORKSPACE_ID,
  GITHUB_CONNECTOR_ENV,
  SETUP_STATE_VERSION,
  getSetupStatus,
  readSetupState,
  repositoryInputForSetup,
  requireSetupReady,
  resolveGitHubConnector,
  saveGitHubWritebackSetup,
  saveSetupState,
  saveWorkingRepositorySetup,
  setupIssueSchema,
  setupStateSchema,
  setupStatusSchema,
  type ReadySetupState,
  type SetupCapability,
  type SetupIssue,
  type SetupState,
  type SetupStatus,
};
export { resolveGitHubAppInstallationToken as resolveGitHubWritebackToken };

export async function preflightGitHubWritebackSetup(
  ctx: ToolContext,
  state: SetupState,
): Promise<SetupStatus> {
  const status = evaluateSetupState(state);
  if (state.workingRepositoryInput === undefined) return status;

  const preflight = await runGitHubWritebackPreflight({
    state,
    abortSignal: ctx.abortSignal,
  });

  return withGitHubPreflight(status, {
    ...preflight,
    issue: githubPreflightIssue(preflight),
  });
}

export function buildSetupInstructions(status: SetupStatus): string {
  if (!status.docsMaintenanceReady) {
    return [
      "## Setup State",
      "",
      "The workspace setup is incomplete. Enter setup mode when the user asks for docs maintenance.",
      "",
      "Greetings, planning, general explanations, and proportional unverified general answers do not require workspace setup.",
      "When workspace grounding is requested, say which configured sources were not verified; do not imply that setup or evidence access succeeded.",
      "Do not ask for repository setup until verified workspace research or a repository-backed docs task is clear.",
      "Once verified workspace research or a repository-backed docs task is clear, ask one question for the working documentation repository GitHub URL if the user has not provided it.",
      "When the user provides a URL, call `configure_working_repository`. Use provided ref/docs root values, but do not require them: ref defaults to `main`, and docs root is detected when the sandbox checkout is first materialized.",
      "Do not call docs-maintenance or publish tools until setup is ready.",
      "",
      "Current setup issues:",
      ...status.issues.map((issue) => `- ${issue.message} Next: ${issue.nextAction}`),
    ].join("\n");
  }

  const repository = status.workingRepository;
  const lines = [
    "## Setup State",
    "",
    `Working documentation repository is configured: ${repository?.repositoryUrl ?? "unknown"} (${repository?.ref ?? "main"}).`,
  ];

  if (repository?.docsRoot !== undefined) {
    lines.push(`Configured docs root: ${repository.docsRoot}.`);
  } else {
    lines.push("Docs root will be detected during sandbox materialization.");
  }

  lines.push(
    "For normal docs maintenance, use the configured repository instead of asking for the same setup again.",
  );

  if (status.watchedRepositories.length > 0) {
    lines.push(
      `Configured watched repositories for read-only source evidence: ${status.watchedRepositories
        .map((watchedRepository) => `${watchedRepository.name} (${watchedRepository.repositoryUrl})`)
        .join(", ")}.`,
    );
    lines.push(
      "For watched repository scans, use the configured watched repositories as read-only evidence sources and keep writeback limited to the working documentation repository.",
    );
  }

  if (status.contextRepositories.length > 0) {
    lines.push(
      `Configured context repositories for read-only workspace knowledge: ${status.contextRepositories
        .map((repository) => `${repository.name} (${repository.repositoryUrl})`)
        .join(", ")}.`,
    );
  }

  if (!status.githubWritebackReady) {
    lines.push(
      "If the user requests GitHub draft PR writeback, finish GitHub writeback setup first by calling `get_setup_status` with `checkGitHubWriteback: true` or `configure_github_writeback`.",
    );
  }

  return lines.join("\n");
}

function withGitHubPreflight(
  status: SetupStatus,
  input: {
    status: SetupStatus["githubWriteback"]["preflight"]["status"];
    message: string;
    issue: SetupIssue;
  },
): SetupStatus {
  const nextIssues = status.issues.filter(
    (issue) => issue.code !== "github-writeback-ready",
  );

  if (input.issue.code !== "github-writeback-ready") {
    nextIssues.push(input.issue);
  }

  const githubWritebackReady =
    status.docsMaintenanceReady &&
    input.status === "ready" &&
    !nextIssues.some((issue) => issue.capability === "github-writeback");

  return {
    ...status,
    githubWritebackReady,
    githubWriteback: {
      ...status.githubWriteback,
      preflight: {
        checked: true,
        status: input.status,
        message: input.message,
      },
    },
    issues: nextIssues,
  };
}

function githubPreflightIssue(preflight: GitHubWritebackPreflight): SetupIssue {
  switch (preflight.status) {
    case "ready":
      return {
        code: "github-writeback-ready",
        capability: "github-writeback",
        message: "GitHub writeback preflight passed.",
        nextAction: "Continue with the approved publish flow.",
      };
    case "missing-connector":
      return {
        code: "github-connector-missing",
        capability: "github-writeback",
        message: "The configured GitHub connector was not found.",
        nextAction: "Attach or configure the GitHub connector for this runtime.",
      };
    case "app-not-installed":
      return {
        code: "github-app-not-installed",
        capability: "github-writeback",
        message: "No GitHub App installation is available for writeback.",
        nextAction: "Ask a GitHub admin to install the app, then retry setup validation.",
      };
    case "repository-not-granted":
      return {
        code: "github-repository-not-granted",
        capability: "github-writeback",
        message: "The working documentation repository is not granted to the GitHub App.",
        nextAction: "Grant the app access to the repository, then retry setup validation.",
      };
    case "insufficient-permissions":
      return {
        code: "github-insufficient-permissions",
        capability: "github-writeback",
        message: "The GitHub App lacks required writeback permissions.",
        nextAction: "Grant contents:write and pull_requests:write, then retry setup validation.",
      };
    case "connector-unavailable":
      return {
        code: "github-connector-unavailable",
        capability: "github-writeback",
        message: "The GitHub connector is not available to this runtime environment.",
        nextAction: "Reconnect the connector, then retry setup validation.",
      };
  }
}
