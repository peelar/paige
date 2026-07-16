import type { SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { err, ok, Result, ResultAsync } from "neverthrow";

import {
  assertDocumentationRepository,
  repositories,
} from "../config";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
} from "../files";
import { SandboxGit } from "../git";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "../shared/errors";
import { RepositoryError } from "../shared/errors";
import {
  createGitHubRequest,
  GitHubRepository,
  resolveGitHubToken,
} from "../shared/github";
import { serializeSandbox } from "../shared/serialization";
import type {
  DocumentationRepository,
  RepositoryConfig,
} from "../types";
import { DocumentationDraft } from "./draft";
import {
  DocumentationPublisher,
  validateDocumentationWritebackInput,
} from "./publisher";
import type { DocumentationWritebackInput } from "./types";
import { DocumentationWorkspace } from "./workspace";

interface DocumentationRepositoryServiceOptions {
  repositories?: RepositoryConfig[];
  getGitHubToken?: () => RepositoryResultAsync<string>;
}

export class DocumentationRepositoryService {
  readonly #ctx: ToolContext;
  readonly #repositories: RepositoryConfig[];
  readonly #getGitHubToken: () => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: DocumentationRepositoryServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories ?? repositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  prepareWorkspace() {
    return this.#documentationRepository().asyncAndThen((repository) =>
      this.#getGitHubToken().andThen((token) =>
        this.#github(repository, token).resolveCommit().andThen((resolved) =>
          this.#withSandbox((sandbox) =>
            new SandboxGit(sandbox).ensureCommits({
              repository,
              commits: [resolved],
              token,
            }).andThen(([cache]) =>
              new DocumentationWorkspace({
                sandbox,
                abortSignal: this.#ctx.abortSignal,
              }).prepare(cache)
            )
          )
        )
      )
    );
  }

  listFiles(input: { pathPrefix: string; limit: number }) {
    return assertRepositoryRelativePath(
      input.pathPrefix,
      { allowRoot: true },
    ).asyncAndThen((pathPrefix) =>
      this.#withReadyDraft((draft) =>
        draft.listFiles({ pathPrefix, limit: input.limit })
      )
    );
  }

  search(input: {
    query: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertSearchQuery(input.query),
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
    ]).asyncAndThen(([query, pathPrefix]) =>
      this.#withReadyDraft((draft) =>
        draft.search({
          query,
          pathPrefix,
          limit: input.limit,
        })
      )
    );
  }

  read(input: {
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withReadyDraft((draft) =>
        draft.read({
          path,
          startLine: input.startLine,
          endLine: input.endLine,
          maxCharacters: input.maxCharacters,
        })
      )
    );
  }

  write(input: { path: string; content: string }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withReadyDraft((draft) =>
        draft.write({ path, content: input.content })
      )
    );
  }

  remove(input: { path: string }) {
    return assertRepositoryRelativePath(
      input.path,
      { allowRoot: false },
    ).asyncAndThen((path) =>
      this.#withReadyDraft((draft) => draft.remove({ path }))
    );
  }

  inspectDiff() {
    return this.#withReadyDraft((draft) => draft.inspectDiff());
  }

  writeback(input: DocumentationWritebackInput) {
    const normalized = validateDocumentationWritebackInput(input);
    if (normalized.isErr()) {
      return new ResultAsync(Promise.resolve(err(normalized.error)));
    }
    return this.#documentationRepository().asyncAndThen((repository) =>
      this.#getGitHubToken().andThen((token) =>
        this.#withSandbox((sandbox) => {
          const workspace = new DocumentationWorkspace({
            sandbox,
            abortSignal: this.#ctx.abortSignal,
          });
          return workspace.load(repository).andThen((state) =>
            new ResultAsync(
              new DocumentationPublisher({
                state,
                workspace,
                draft: new DocumentationDraft({
                  sandbox,
                  state,
                  abortSignal: this.#ctx.abortSignal,
                }),
                github: this.#github(repository, token),
              }).publish(normalized.value),
            )
          );
        })
      )
    );
  }

  #withReadyDraft<T>(
    operation: (draft: DocumentationDraft) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return this.#documentationRepository().asyncAndThen((repository) =>
      this.#withSandbox((sandbox) => {
        const workspace = new DocumentationWorkspace({
          sandbox,
          abortSignal: this.#ctx.abortSignal,
        });
        return workspace.load(repository).andThen((state) =>
          operation(new DocumentationDraft({
            sandbox,
            state,
            abortSignal: this.#ctx.abortSignal,
          }))
        );
      })
    );
  }

  #documentationRepository(): RepositoryResult<DocumentationRepository> {
    const candidates = this.#repositories.filter(
      (repository) => repository.role === "documentation",
    );
    if (candidates.length !== 1) {
      return err(new RepositoryError(
        "REPOSITORY_NOT_CONFIGURED",
        "Configure exactly one documentation repository.",
      ));
    }
    return assertDocumentationRepository(candidates[0]);
  }

  #github(
    repository: DocumentationRepository,
    token: string,
  ): GitHubRepository<DocumentationRepository> {
    return new GitHubRepository(
      repository,
      createGitHubRequest({
        token,
        abortSignal: this.#ctx.abortSignal,
      }),
    );
  }

  #withSandbox<T>(
    operation: (sandbox: SandboxSession) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    return new ResultAsync(
      this.#ctx.getSandbox().then((sandbox) => ok(sandbox)),
    ).andThen((sandbox) =>
      serializeSandbox(sandbox.id, () => operation(sandbox))
    );
  }
}
