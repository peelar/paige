import type { SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";

import {
  catalogRepositories,
  repositories,
  resolveConfiguredRepository,
} from "./config";
import { SandboxGit } from "./git";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
  RepositoryFiles,
} from "./files";
import type { RepositoryResultAsync } from "./shared/errors";
import {
  createGitHubRequest,
  GitHubRepository,
  resolveGitHubToken,
} from "./shared/github";
import { serializeSandbox } from "./shared/serialization";
import type {
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "./types";

interface RepositoryServiceOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;
}

export class RepositoryService {
  readonly #ctx: ToolContext;
  readonly #repositories: RepositoryConfig[];
  readonly #getGitHubToken: (
    repository: RepositoryConfig,
  ) => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: RepositoryServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories ?? repositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  /** Describes the fixed repository catalog without acquiring a sandbox. */
  catalog(): RepositoryConfig[] {
    return catalogRepositories(this.#repositories);
  }

  listFiles(input: {
    repositoryId: string;
    ref?: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([pathPrefix, repository]) =>
      this.#files(repository, input.ref, (files) =>
        files.list({
          pathPrefix,
          limit: input.limit,
        }),
      ),
    );
  }

  search(input: {
    repositoryId: string;
    ref?: string;
    query: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertSearchQuery(input.query),
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([query, pathPrefix, repository]) =>
      this.#files(repository, input.ref, (files) =>
        files.search({
          query,
          pathPrefix,
          limit: input.limit,
        }),
      ),
    );
  }

  read(input: {
    repositoryId: string;
    ref?: string;
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.path, { allowRoot: false }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([path, repository]) =>
      this.#files(repository, input.ref, (files) =>
        files.read({
          path,
          startLine: input.startLine,
          endLine: input.endLine,
          maxCharacters: input.maxCharacters,
        }),
      ),
    );
  }

  compare(input: {
    repositoryId: string;
    baseRef: string;
    headRef: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredRepository(this.#repositories, input.repositoryId),
    ]).asyncAndThen(([pathPrefix, repository]) =>
      this.#resolve(repository, [input.baseRef, input.headRef])
        .andThen(({ token, commits }) =>
          this.#withSandbox(
            repository,
            commits,
            token,
            (sandbox, workspaces) => {
              const files = new RepositoryFiles(sandbox, workspaces[1]);
              return files.compareWith(workspaces[0], {
                pathPrefix,
                limit: input.limit,
              });
            },
          )
        ),
    );
  }

  #files<T>(
    repository: RepositoryConfig,
    ref: string | undefined,
    operation: (files: RepositoryFiles) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return this.#resolve(repository, [ref])
      .andThen(({ token, commits }) =>
        this.#withSandbox(
          repository,
          commits,
          token,
          (sandbox, workspaces) =>
            operation(new RepositoryFiles(sandbox, workspaces[0])),
        )
      );
  }

  #resolve(
    repository: RepositoryConfig,
    refs: Array<string | undefined>,
  ): RepositoryResultAsync<{
    token: string;
    commits: ResolvedRepository[];
  }> {
    return this.#getGitHubToken(repository).andThen((token) =>
      new ResultAsync((async () => {
        const github = new GitHubRepository(
          repository,
          createGitHubRequest({
            token,
            abortSignal: this.#ctx.abortSignal,
          }),
        );
        const results = await Promise.all(
          refs.map(async (ref) => await github.resolveCommit(ref)),
        );
        const combined = Result.combine(results);
        if (combined.isErr()) return err(combined.error);
        return ok({
          token,
          commits: combined.value,
        });
      })())
    );
  }

  #withSandbox<T>(
    repository: RepositoryConfig,
    commits: ResolvedRepository[],
    token: string,
    operation: (
      sandbox: SandboxSession,
      workspaces: RepositoryWorkspace[],
    ) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return new ResultAsync(
      this.#ctx.getSandbox().then((sandbox) => ok(sandbox)),
    ).andThen((sandbox) =>
      serializeSandbox(sandbox.id, () => {
        const git = new SandboxGit(sandbox);
        return git.ensureCommits({
          repository,
          commits,
          token,
        }).andThen((workspaces) => operation(sandbox, workspaces));
      }),
    );
  }
}
