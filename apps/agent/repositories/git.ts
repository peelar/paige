import type {
  SandboxCommandResult,
  SandboxSession,
} from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "./shared/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "./shared/errors";
import type {
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "./types";

const REPOSITORY_PATH_PREFIX = "/workspace/repositories";

export class SandboxGit {
  readonly #sandbox: SandboxSession;

  constructor(sandbox: SandboxSession) {
    this.#sandbox = sandbox;
  }

  /**
   * Ensures the requested commits exist in one cached shallow Git
   * repository. No working tree checkout is required for read operations.
   */
  ensureCommits<TRepository extends RepositoryConfig>(input: {
    repository: TRepository;
    commits: ResolvedRepository<TRepository>[];
    token?: string;
  }): RepositoryResultAsync<RepositoryWorkspace<TRepository>[]> {
    return new ResultAsync((async () => {
      if (input.commits.length === 0) {
        return err(new RepositoryError(
          "REPOSITORY_INVALID_INPUT",
          "At least one repository commit is required.",
        ));
      }

      const path = `${REPOSITORY_PATH_PREFIX}/${input.repository.id}`;
      const initialized = await this.#ensureRepositoryInitialized(
        path,
        githubRemoteUrl(input.repository),
      );
      if (initialized.isErr()) return err(initialized.error);

      const missing: ResolvedRepository<TRepository>[] = [];
      for (const commit of input.commits) {
        if (!(await this.#hasCommit(path, commit.commitSha))) {
          missing.push(commit);
        }
      }

      if (missing.length > 0) {
        const fetched = await this.#withGitHubAccess(
          input.token,
          input.commits[0].isPrivate,
          async () => {
            for (const commit of missing) {
              const fetchResult = await this.#run(
                `cd ${quoteShellArgument(path)} && GIT_TERMINAL_PROMPT=0 git fetch --depth=1 --no-tags origin ${quoteShellArgument(commit.commitSha)}`,
              );
              const successful = successfulCommand(
                fetchResult,
                `Failed to fetch repository ${input.repository.id} ref ${commit.ref}`,
              );
              if (successful.isErr()) return err(successful.error);
            }
            return ok(undefined);
          },
        );
        if (fetched.isErr()) return err(fetched.error);
      }

      for (const commit of input.commits) {
        if (!(await this.#hasCommit(path, commit.commitSha))) {
          return err(new RepositoryError(
            "REPOSITORY_SANDBOX_FAILED",
            `Fetched repository ${input.repository.id} did not contain commit ${commit.commitSha}.`,
          ));
        }
      }

      return ok(input.commits.map((repository) => ({ path, repository })));
    })());
  }

  /**
   * Checks out one commit without discarding existing changes.
   */
  checkoutCommit<TRepository extends RepositoryConfig>(
    workspace: RepositoryWorkspace<TRepository>,
  ): RepositoryResultAsync<RepositoryWorkspace<TRepository>> {
    return new ResultAsync((async () => {
      const statusResult = await this.#run(
        `cd ${quoteShellArgument(workspace.path)} && git status --porcelain`,
      );
      const status = successfulCommand(
        statusResult,
        `Failed to inspect repository ${workspace.repository.id} status`,
      );
      if (status.isErr()) return err(status.error);
      if (statusResult.stdout.trim() !== "") {
        return err(new RepositoryError(
          "REPOSITORY_DIRTY_WORKSPACE",
          `Repository workspace has uncommitted changes: ${workspace.repository.id}`,
        ));
      }

      const checkoutResult = await this.#run(
        `cd ${quoteShellArgument(workspace.path)} && git checkout --detach ${quoteShellArgument(workspace.repository.commitSha)}`,
      );
      const checkedOut = successfulCommand(
        checkoutResult,
        `Failed to check out repository ${workspace.repository.id}`,
      );
      if (checkedOut.isErr()) return err(checkedOut.error);

      return ok(workspace);
    })());
  }

  async #ensureRepositoryInitialized(
    path: string,
    remoteUrl: string,
  ): Promise<RepositoryResult<void>> {
    const gitDirectory = await this.#run(
      `test -d ${quoteShellArgument(`${path}/.git`)}`,
    );
    if (gitDirectory.exitCode === 0) {
      const remoteResult = await this.#run(
        `cd ${quoteShellArgument(path)} && git remote get-url origin`,
      );
      const remote = successfulCommand(
        remoteResult,
        "Failed to inspect repository origin",
      );
      if (remote.isErr()) return err(remote.error);
      if (remoteResult.stdout.trim() === remoteUrl) return ok(undefined);

      const statusResult = await this.#run(
        `cd ${quoteShellArgument(path)} && git status --porcelain`,
      );
      const status = successfulCommand(
        statusResult,
        "Failed to inspect repository status",
      );
      if (status.isErr()) return err(status.error);
      if (statusResult.stdout.trim() !== "") {
        return err(new RepositoryError(
          "REPOSITORY_DIRTY_WORKSPACE",
          `Refusing to replace a repository workspace with uncommitted changes: ${path}`,
        ));
      }
    }

    await this.#sandbox.removePath({
      path,
      force: true,
      recursive: true,
    });

    const initializeResult = await this.#run(
      `mkdir -p ${quoteShellArgument(path)} && cd ${quoteShellArgument(path)} && git init && git remote add origin ${quoteShellArgument(remoteUrl)}`,
    );
    return successfulCommand(
      initializeResult,
      `Failed to initialize repository workspace ${path}`,
    );
  }

  async #hasCommit(path: string, commitSha: string): Promise<boolean> {
    const result = await this.#run(
      `cd ${quoteShellArgument(path)} && git cat-file -e ${quoteShellArgument(`${commitSha}^{commit}`)}`,
    );
    return result.exitCode === 0;
  }

  async #withGitHubAccess<T>(
    token: string | undefined,
    authenticated: boolean,
    operation: () => Promise<RepositoryResult<T>>,
  ): Promise<RepositoryResult<T>> {
    if (authenticated && token === undefined) {
      return err(new RepositoryError(
        "REPOSITORY_GITHUB_AUTH_FAILED",
        "Private repository access requires a GitHub installation token.",
      ));
    }
    try {
      await this.#sandbox.setNetworkPolicy(
        this.#githubNetworkPolicy(token, authenticated),
      );
      return await operation();
    } finally {
      await this.#sandbox.setNetworkPolicy("deny-all");
    }
  }

  #githubNetworkPolicy(token: string | undefined, authenticated: boolean) {
    const rules = authenticated && token !== undefined
      ? [
          {
            transform: [
              {
                headers: {
                  Authorization: `Basic ${Buffer.from(
                    `x-access-token:${token}`,
                  ).toString("base64")}`,
                },
              },
            ],
          },
        ]
      : [];
    return {
      allow: {
        "github.com": rules,
        "codeload.github.com": rules,
      },
    };
  }

  async #run(command: string): Promise<SandboxCommandResult> {
    return await this.#sandbox.run({ command });
  }
}

function githubRemoteUrl(repository: RepositoryConfig): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

function successfulCommand(
  result: SandboxCommandResult,
  message: string,
): RepositoryResult<void> {
  if (result.exitCode !== 0) {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `${message}: ${summarizeCommandFailure(result)}`,
    ));
  }
  return ok(undefined);
}

function summarizeCommandFailure(result: SandboxCommandResult): string {
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `command exited with ${result.exitCode}`
  ).slice(0, 1_000);
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
