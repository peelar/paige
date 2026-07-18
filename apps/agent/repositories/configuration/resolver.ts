import { err, ok } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResultAsync } from "../shared/errors";
import type { RepositoryConfig } from "../types";
import { repositoryConfigurationStore } from "./database";
import type { RepositoryConfigurationStore } from "./store";

export function resolveRepositoryCatalog(
  store: RepositoryConfigurationStore = repositoryConfigurationStore(),
): RepositoryResultAsync<RepositoryConfig[]> {
  return store.get().andThen((configuration) =>
    configuration === undefined
      ? err(new RepositoryError(
          "REPOSITORY_NOT_CONFIGURED",
          "Connect repositories before using repository access.",
        ))
      : ok([
          ...configuration.evidenceRepositories,
          configuration.documentationRepository,
        ])
  );
}
