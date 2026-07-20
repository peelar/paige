import { err, Result, ResultAsync } from "neverthrow";

import { assertDocumentationRepository } from "../config";
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
  ) => RepositoryResultAsync<RepositoryConfig>;
  getGitHubToken?: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;
}

export class RepositoryConfigurationService {
  readonly #abortSignal: AbortSignal;
  readonly #store: RepositoryConfigurationStore;
  readonly #validateRepository: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<RepositoryConfig>;
  readonly #getGitHubToken: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;

  constructor(
    request: { abortSignal: AbortSignal },
    store: RepositoryConfigurationStore,
    options: RepositoryConfigurationServiceOptions = {},
  ) {
    this.#abortSignal = request.abortSignal;
    this.#store = store;
    this.#getGitHubToken = options.getGitHubToken ?? resolveGitHubToken;
    this.#validateRepository = options.validateRepository ??
      ((repository) => this.#validateGitHubRepository(repository));
  }

  get(): RepositoryResultAsync<ActiveRepositoryConfiguration | undefined> {
    return this.#store.get();
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
      return validated.andThen(([documentationRepository, ...evidenceRepositories]) =>
        assertDocumentationRepository(documentationRepository).map(
          (validatedDocumentationRepository) => ({
            documentationRepository: validatedDocumentationRepository,
            evidenceRepositories,
          }),
        )
      );
    })());
  }

  confirm(input: {
    configuration: RepositoryConfigurationData;
    expectedRevision: number | null;
  }): RepositoryResultAsync<ActiveRepositoryConfiguration> {
    return this.#store.save(input);
  }

  #validateGitHubRepository(
    repository: RepositoryConfig,
  ): RepositoryResultAsync<RepositoryConfig> {
    if (repository.role === "evidence") {
      const publicRepository = new GitHubRepository(
        repository,
        createGitHubRequest({ abortSignal: this.#abortSignal }),
      );
      return publicRepository.resolveCommit()
        .map(() => ({ ...repository, access: "public" as const }))
        .orElse((error) =>
          error.code === "REPOSITORY_GITHUB_NOT_FOUND"
            ? this.#validateInstallationRepository(repository)
            : err(error)
        )
        .mapErr((error) => this.#accessError(repository, error));
    }

    return this.#validateInstallationRepository(repository)
      .mapErr((error) => this.#accessError(repository, error));
  }

  #validateInstallationRepository(
    repository: RepositoryConfig,
  ): RepositoryResultAsync<RepositoryConfig> {
    return this.#getGitHubToken(repository)
      .andThen((token) =>
        new GitHubRepository(
          repository,
          createGitHubRequest({
            token,
            abortSignal: this.#abortSignal,
          }),
        ).resolveCommit()
      )
      .map(() => ({ ...repository, access: "installation" as const }));
  }

  #accessError(
    repository: RepositoryConfig,
    error: RepositoryError,
  ): RepositoryError {
    if (
      error.code === "REPOSITORY_GITHUB_AUTH_FAILED" ||
      error.code === "REPOSITORY_GITHUB_RATE_LIMITED"
    ) {
      return error;
    }
    return new RepositoryError(
      "REPOSITORY_GITHUB_FAILED",
      `I couldn't access ${repository.owner}/${repository.name} with the access Paige needs.`,
      { cause: error },
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
