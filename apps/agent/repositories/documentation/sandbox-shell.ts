import type {
  SandboxCommandResult,
  SandboxSession,
} from "eve/sandbox";
import { err, ok } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";

// Adapts Eve's sandbox process API to the documentation repository's error
// model. Drafts and worktrees use this instead of interpreting raw process
// results independently.
export class DocumentationSandboxShell {
  readonly #sandbox: SandboxSession;
  readonly #abortSignal: AbortSignal;

  constructor(input: {
    sandbox: SandboxSession;
    abortSignal: AbortSignal;
  }) {
    this.#sandbox = input.sandbox;
    this.#abortSignal = input.abortSignal;
  }

  async run(command: string): Promise<DocumentationSandboxCommand> {
    const result = await this.#sandbox.run({
      command,
      abortSignal: this.#abortSignal,
    });
    return new DocumentationSandboxCommand(result);
  }

  async read(
    command: string,
    failureMessage: string,
    options: { trim?: boolean } = {},
  ): Promise<RepositoryResult<string>> {
    const result = await this.run(command);
    const successful = result.assertSucceeded(failureMessage);
    if (successful.isErr()) return err(successful.error);
    return ok(options.trim === false ? result.stdout : result.stdout.trim());
  }

  async readNullSeparated(
    command: string,
    failureMessage: string,
  ): Promise<RepositoryResult<string[]>> {
    const result = await this.run(command);
    const successful = result.assertSucceeded(failureMessage);
    if (successful.isErr()) return err(successful.error);
    return ok(result.nullSeparatedOutput());
  }

  async pathExists(path: string): Promise<boolean> {
    const result = await this.run(`test -e ${quoteShellArgument(path)}`);
    return result.exitCode === 0;
  }
}

// Keeps the raw exit code available for commands such as `git diff --no-index`,
// where more than one exit code is expected, while centralizing normal failure
// handling and output decoding.
export class DocumentationSandboxCommand {
  readonly #result: SandboxCommandResult;

  constructor(result: SandboxCommandResult) {
    this.#result = result;
  }

  get exitCode(): number {
    return this.#result.exitCode;
  }

  get stdout(): string {
    return this.#result.stdout;
  }

  assertSucceeded(message: string): RepositoryResult<void> {
    if (this.exitCode !== 0) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `${message}: ${this.failureSummary()}`,
      ));
    }
    return ok(undefined);
  }

  failureSummary(): string {
    return (
      this.#result.stderr.trim() ||
      this.stdout.trim() ||
      `command exited with ${this.exitCode}`
    ).slice(0, 1_000);
  }

  nullSeparatedOutput(): string[] {
    return this.stdout.split("\0").filter(Boolean);
  }
}

export function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
