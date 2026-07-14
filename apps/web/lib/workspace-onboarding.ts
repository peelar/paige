import "server-only";

import {
  readWorkspaceOnboardingDraft,
  workspaceOnboardingDraftSchema,
  type WorkspaceOnboardingDraft,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_READINESS_TEST_SCENARIOS";

export type WorkspaceOnboardingInitialState = {
  draft: WorkspaceOnboardingDraft;
  error: string | null;
};

export async function resolveWorkspaceOnboardingInitialState(
  requestedScenario?: string,
): Promise<WorkspaceOnboardingInitialState> {
  if (process.env[TEST_SCENARIO_ENV] === "1" && requestedScenario !== undefined) {
    return {
      draft: workspaceOnboardingDraftSchema.parse({
        repositoryUrl: "https://github.com/example/docs",
        githubConnector: "github/docs-agent",
        watchedRepositories: [],
        contextRepositories: [],
      }),
      error: null,
    };
  }

  try {
    return { draft: await readWorkspaceOnboardingDraft(), error: null };
  } catch {
    return {
      draft: workspaceOnboardingDraftSchema.parse({
        repositoryUrl: "",
        watchedRepositories: [],
        contextRepositories: [],
      }),
      error:
        "Workspace setup could not be loaded. Restore database access and run the committed migrations before saving changes.",
    };
  }
}
