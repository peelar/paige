import type { ToolContext } from "eve/tools";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResultAsync } from "../shared/errors";
import type { RepositoryConfig } from "../types";
import { resolveSlackWorkspaceId } from "./context";
import { repositoryConfigurationStore } from "./database";
import type { RepositoryConfigurationStore } from "./store";

export function resolveRepositoryCatalog(
  ctx: ToolContext,
  store: RepositoryConfigurationStore = repositoryConfigurationStore(),
): RepositoryResultAsync<RepositoryConfig[]> {
  const workspaceId = resolveSlackWorkspaceId(ctx);
  if (workspaceId.isErr()) {
    return new ResultAsync(Promise.resolve(err(workspaceId.error)));
  }

  return store.get(workspaceId.value).andThen((configuration) =>
    configuration === undefined
      ? err(new RepositoryError(
          "REPOSITORY_NOT_CONFIGURED",
          "Connect repositories for this Slack workspace before using repository access.",
        ))
      : ok([
          ...configuration.evidenceRepositories,
          configuration.documentationRepository,
        ])
  );
}
