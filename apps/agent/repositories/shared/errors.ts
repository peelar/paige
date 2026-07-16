import type { Result, ResultAsync } from "neverthrow";

export type RepositoryErrorCode =
  | "REPOSITORY_APPROVAL_MISMATCH"
  | "REPOSITORY_CONFIGURATION_FAILED"
  | "REPOSITORY_CONFLICT"
  | "REPOSITORY_DIFF_REJECTED"
  | "REPOSITORY_DIRTY_WORKSPACE"
  | "REPOSITORY_FILE_NOT_FOUND"
  | "REPOSITORY_GITHUB_AUTH_FAILED"
  | "REPOSITORY_GITHUB_FAILED"
  | "REPOSITORY_INVALID_INPUT"
  | "REPOSITORY_NOT_CONFIGURED"
  | "REPOSITORY_SANDBOX_FAILED"
  | "REPOSITORY_WRITE_FORBIDDEN";

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
