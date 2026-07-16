import type { ToolContext } from "eve/tools";
import { err, ok } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResult } from "../shared/errors";

interface SessionContext {
  session: {
    auth: ToolContext["session"]["auth"];
  };
}

export function resolveSlackWorkspaceId(
  ctx: SessionContext,
): RepositoryResult<string> {
  const auth = ctx.session.auth.current;
  const workspaceId = auth?.attributes.slackWorkspaceId;

  if (
    auth?.authenticator !== "slack" ||
    typeof workspaceId !== "string" ||
    workspaceId.trim() === ""
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFIGURATION_FAILED",
      "This conversation is missing its verified Slack workspace identity.",
    ));
  }

  return ok(workspaceId);
}
