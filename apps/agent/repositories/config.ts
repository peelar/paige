import { err, ok } from "neverthrow";

import { RepositoryError } from "./shared/errors";
import type { RepositoryResult } from "./shared/errors";
import type {
  DocumentationRepository,
  RepositoryConfig,
} from "./types";

/** Returns the repositories Paige is explicitly allowed to inspect. */
export function catalogRepositories(
  config: RepositoryConfig[],
): RepositoryConfig[] {
  return [...config];
}

/** Resolves a model-facing repository ID without accepting arbitrary origins. */
export function resolveConfiguredRepository(
  config: RepositoryConfig[],
  repositoryId: string,
): RepositoryResult<RepositoryConfig> {
  const repository = catalogRepositories(config).find(
    (candidate) => candidate.id === repositoryId,
  );
  if (repository === undefined) {
    return err(new RepositoryError(
      "REPOSITORY_NOT_CONFIGURED",
      `Repository is not configured: ${repositoryId}`,
    ));
  }
  return ok(repository);
}

/** Enforces the only repository role that may enter a writeback workflow. */
export function assertDocumentationRepository(
  repository: RepositoryConfig,
): RepositoryResult<DocumentationRepository> {
  if (repository.role !== "documentation") {
    return err(new RepositoryError(
      "REPOSITORY_WRITE_FORBIDDEN",
      `Repository is read-only: ${repository.id}`,
    ));
  }
  return ok(repository as DocumentationRepository);
}
