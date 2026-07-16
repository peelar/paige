import type { Result, ResultAsync } from "neverthrow";

export type RepositoryErrorCode =
  | "REPOSITORY_FILE_NOT_FOUND"
  | "REPOSITORY_GITHUB_AUTH_FAILED"
  | "REPOSITORY_GITHUB_FAILED"
  | "REPOSITORY_INVALID_INPUT"
  | "REPOSITORY_NOT_CONFIGURED"
  | "REPOSITORY_SANDBOX_FAILED";

/** A failure Paige can safely report as part of the repository tool contract. */
export class RepositoryError extends Error {
  override readonly name = "RepositoryError";

  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type RepositoryResult<T> = Result<T, RepositoryError>;
export type RepositoryResultAsync<T> = ResultAsync<T, RepositoryError>;
