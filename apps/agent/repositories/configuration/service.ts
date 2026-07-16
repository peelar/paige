import type { ToolContext } from "eve/tools";
import { err, Result, ResultAsync } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResultAsync } from "../shared/errors";
import {
  createGitHubRequest,
  GitHubRepository,
  resolveGitHubToken,
} from "../shared/github";
import type { RepositoryConfig } from "../types";
import { normalizeRepositoryConfiguration } from "./normalize";
import type { RepositoryConfigurationStore } from "./store";
import type {
  ActiveRepositoryConfiguration,
  RepositoryConfigurationData,
} from "./types";

interface RepositoryConfigurationServiceOptions {
  validateRepository?: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<void>;
}

export class RepositoryConfigurationService {
  readonly #ctx: ToolContext;
  readonly #store: RepositoryConfigurationStore;
  readonly #validateRepository: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<void>;

  constructor(
    ctx: ToolContext,
    store: RepositoryConfigurationStore,
    options: RepositoryConfigurationServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#store = store;
    this.#validateRepository = options.validateRepository ??
      ((repository) => this.#validateGitHubRepository(repository));
  }

  get(
    workspaceId: string,
  ): RepositoryResultAsync<ActiveRepositoryConfiguration | undefined> {
    return this.#store.get(workspaceId);
  }

  propose(input: {
    documentationRepositoryUrl: string;
    evidenceRepositoryUrls: string[];
  }): RepositoryResultAsync<RepositoryConfigurationData> {
    const normalized = normalizeRepositoryConfiguration(input);
    if (normalized.isErr()) {
      return new ResultAsync(Promise.resolve(err(normalized.error)));
    }

    const repositories = [
      normalized.value.documentationRepository,
      ...normalized.value.evidenceRepositories,
    ];
    return new ResultAsync((async () => {
      const validated = Result.combine(
        await Promise.all(
          repositories.map(async (repository) =>
            await this.#validateRepository(repository)
          ),
        ),
      );
      return validated.map(() => normalized.value);
    })());
  }

  confirm(input: {
    workspaceId: string;
    configuration: RepositoryConfigurationData;
    expectedRevision: number | null;
  }): RepositoryResultAsync<ActiveRepositoryConfiguration> {
    return this.#store.save(input);
  }

  #validateGitHubRepository(
    repository: RepositoryConfig,
  ): RepositoryResultAsync<void> {
    return resolveGitHubToken(repository)
      .andThen((token) =>
        new GitHubRepository(
          repository,
          createGitHubRequest({
            token,
            abortSignal: this.#ctx.abortSignal,
          }),
        ).resolveCommit()
      )
      .map(() => undefined)
      .mapErr((error) =>
        new RepositoryError(
          error.code === "REPOSITORY_GITHUB_AUTH_FAILED"
            ? error.code
            : "REPOSITORY_GITHUB_FAILED",
          `I couldn't access ${repository.owner}/${repository.name} with the access Paige needs.`,
          { cause: error },
        )
      );
  }
}

export function summarizeRepositoryConfiguration(
  configuration: RepositoryConfigurationData,
): {
  documentationRepository: string;
  evidenceRepositories: string[];
} {
  return {
    documentationRepository: repositoryName(
      configuration.documentationRepository,
    ),
    evidenceRepositories: configuration.evidenceRepositories.map(
      repositoryName,
    ),
  };
}

function repositoryName(repository: RepositoryConfig): string {
  return `${repository.owner}/${repository.name}`;
}
