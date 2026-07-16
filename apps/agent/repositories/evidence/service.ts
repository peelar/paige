import type { SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { ok, okAsync, Result, ResultAsync } from "neverthrow";

import { serializeSandbox } from "../shared/serialization";
import { ensureEvidenceRepositoryCheckout } from "./checkout";
import {
  catalogEvidenceRepositories,
  evidenceRepositories,
  resolveConfiguredEvidenceRepository,
} from "./config";
import type { RepositoryResultAsync } from "../shared/errors";
import { resolveGitHubToken } from "../shared/github";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
  listEvidenceRepositoryFiles,
  readEvidenceRepositoryFile,
  searchEvidenceRepository,
} from "./inspection";
import type { RepositoryCheckout } from "../shared/types";
import type { EvidenceRepository } from "./types";

interface EvidenceRepositoryServiceOptions {
  repositories?: EvidenceRepository[];
  getGitHubToken?: (
    repository: EvidenceRepository,
  ) => RepositoryResultAsync<string>;
}

export class EvidenceRepositoryService {
  readonly #ctx: ToolContext;
  readonly #repositories: EvidenceRepository[];
  readonly #getGitHubToken: (
    repository: EvidenceRepository,
  ) => RepositoryResultAsync<string>;

  constructor(
    ctx: ToolContext,
    options: EvidenceRepositoryServiceOptions = {},
  ) {
    this.#ctx = ctx;
    this.#repositories = options.repositories ?? evidenceRepositories;
    this.#getGitHubToken =
      options.getGitHubToken ?? resolveGitHubToken;
  }

  /** Describes the fixed repository catalog without acquiring a sandbox. */
  catalog(): EvidenceRepository[] {
    return catalogEvidenceRepositories(this.#repositories);
  }

  /** Validates a browse request, prepares the checkout, and lists its files. */
  listFiles(input: {
    repositoryId: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredEvidenceRepository(
        this.#repositories,
        input.repositoryId,
      ),
    ]).asyncAndThen(([pathPrefix, repository]) =>
      this.#inspect(repository, (sandbox, checkout) =>
        listEvidenceRepositoryFiles({
          sandbox,
          checkout,
          abortSignal: this.#ctx.abortSignal,
          pathPrefix,
          limit: input.limit,
        }),
      ),
    );
  }

  /** Validates and runs a bounded literal search against one checkout. */
  search(input: {
    repositoryId: string;
    query: string;
    pathPrefix: string;
    limit: number;
  }) {
    return Result.combine([
      assertSearchQuery(input.query),
      assertRepositoryRelativePath(input.pathPrefix, { allowRoot: true }),
      resolveConfiguredEvidenceRepository(
        this.#repositories,
        input.repositoryId,
      ),
    ]).asyncAndThen(([query, pathPrefix, repository]) =>
      this.#inspect(repository, (sandbox, checkout) =>
        searchEvidenceRepository({
          sandbox,
          checkout,
          abortSignal: this.#ctx.abortSignal,
          query,
          pathPrefix,
          limit: input.limit,
        }),
      ),
    );
  }

  /** Validates and reads a bounded range from one repository file. */
  read(input: {
    repositoryId: string;
    path: string;
    startLine: number;
    endLine?: number;
    maxCharacters: number;
  }) {
    return Result.combine([
      assertRepositoryRelativePath(input.path, { allowRoot: false }),
      resolveConfiguredEvidenceRepository(
        this.#repositories,
        input.repositoryId,
      ),
    ]).asyncAndThen(([path, repository]) =>
      this.#inspect(repository, (sandbox, checkout) =>
        readEvidenceRepositoryFile({
          sandbox,
          checkout,
          abortSignal: this.#ctx.abortSignal,
          path,
          startLine: input.startLine,
          endLine: input.endLine,
          maxCharacters: input.maxCharacters,
        }),
      ),
    );
  }

  #inspect<T>(
    repository: EvidenceRepository,
    operation: (
      sandbox: SandboxSession,
      checkout: RepositoryCheckout<EvidenceRepository>,
    ) => RepositoryResultAsync<T>,
  ): RepositoryResultAsync<T> {
    // Sandbox acquisition and unexpected runtime failures stay rejected.
    // Expected repository failures remain typed Result errors through the
    // checkout and inspection pipeline.
    return new ResultAsync(
      this.#ctx.getSandbox().then((sandbox) => ok(sandbox)),
    ).andThen((sandbox) =>
      serializeSandbox(sandbox.id, () =>
        ensureEvidenceRepositoryCheckout({
          sandbox,
          repository,
          getGitHubToken: () =>
            repository.access === "public"
              ? okAsync(undefined)
              : this.#getGitHubToken(repository),
          abortSignal: this.#ctx.abortSignal,
        }).andThen((checkout) => operation(sandbox, checkout)),
      ),
    );
  }
}
