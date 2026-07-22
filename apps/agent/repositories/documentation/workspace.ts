import type { SandboxSession } from "eve/sandbox";
import { err, ok, Result, ResultAsync } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";
import type {
  DocumentationRepository,
  RepositoryConfig,
  RepositoryWorkspace,
  ResolvedRepository,
} from "@paige/repositories/types";
import {
  createDocumentationDiffDigest,
  DocumentationDraft,
} from "./draft";
import {
  isValidPaigeBranch,
  MAX_DIFF_FILES,
  MAX_FILE_BYTES,
} from "./policy";
import {
  type DocumentationSandboxCommand,
  DocumentationSandboxShell,
  quoteShellArgument,
} from "./sandbox-shell";
import type {
  ApprovedDocumentationPublication,
  DocumentationCommit,
  DocumentationWorkspace as DocumentationWorkspaceOutput,
  DocumentationWorkspaceState,
  ProposedDocumentationFile,
} from "./types";

const WORKTREE_ROOT = "/workspace/worktrees";

export class DocumentationWorkspace {
  readonly #sandbox: SandboxSession;
  readonly #shell: DocumentationSandboxShell;
  readonly #abortSignal: AbortSignal;

  constructor(input: {
    sandbox: SandboxSession;
    abortSignal: AbortSignal;
  }) {
    this.#sandbox = input.sandbox;
    this.#shell = new DocumentationSandboxShell(input);
    this.#abortSignal = input.abortSignal;
  }

  prepare(
    cache: RepositoryWorkspace<DocumentationRepository>,
  ): ResultAsync<DocumentationWorkspaceOutput, RepositoryError> {
    return new ResultAsync((async () => {
      const path = worktreePath(cache.repository);
      if (await this.#pathExists(path)) {
        const stored = await this.#readState(cache.repository);
        if (stored.isErr()) return err(stored.error);
        const matching = assertStateMatchesRepository(
          stored.value,
          cache.repository,
        );
        if (matching.isErr()) return err(matching.error);
        const verified = await this.#verifyIdentity({
          path,
          cachePath: cache.path,
          repository: stored.value.repository,
        });
        if (verified.isErr()) return err(verified.error);

        const normalized = await this.#normalize(stored.value);
        if (normalized.isErr()) return err(normalized.error);
        const status = await this.#run(
          `git -C ${quoteShellArgument(path)} status --porcelain=v1`,
        );
        const statusOk = status.assertSucceeded(
          "Failed to inspect documentation workspace status",
        );
        if (statusOk.isErr()) return err(statusOk.error);
        if (status.stdout.trim() !== "") {
          return err(new RepositoryError(
            "REPOSITORY_DIRTY_WORKSPACE",
            "The documentation workspace contains uncommitted edits.",
          ));
        }

        const head = await this.#readCommand(
          `git -C ${quoteShellArgument(path)} rev-parse HEAD`,
          "Failed to inspect documentation workspace HEAD",
        );
        if (head.isErr()) return err(head.error);
        if (head.value !== cache.repository.commitSha) {
          const removed = await this.#run(
            `git -C ${quoteShellArgument(cache.path)} worktree remove ${quoteShellArgument(path)}`,
          );
          const removedOk = removed.assertSucceeded(
            "Failed to replace the clean documentation workspace",
          );
          if (removedOk.isErr()) return err(removedOk.error);
          const created = await this.#createWorktree(cache);
          if (created.isErr()) return err(created.error);
        }
      } else {
        const created = await this.#createWorktree(cache);
        if (created.isErr()) return err(created.error);
      }

      const state: DocumentationWorkspaceState = {
        version: 1,
        path,
        cachePath: cache.path,
        repository: cache.repository,
        baseBranch: cache.repository.ref,
        baseCommitSha: cache.repository.commitSha,
      };
      const persisted = await this.#writeState(state);
      if (persisted.isErr()) return err(persisted.error);
      return ok(toDocumentationWorkspace(state));
    })());
  }

  load(
    repository: DocumentationRepository,
  ): ResultAsync<DocumentationWorkspaceState, RepositoryError> {
    return new ResultAsync((async () => {
      const stored = await this.#readState(repository);
      if (stored.isErr()) return err(stored.error);
      const matching = assertStateMatchesRepository(
        stored.value,
        repository,
      );
      if (matching.isErr()) return err(matching.error);
      const verified = await this.#verifyIdentity({
        path: stored.value.path,
        cachePath: stored.value.cachePath,
        repository: stored.value.repository,
      });
      if (verified.isErr()) return err(verified.error);
      return await this.#normalize(stored.value);
    })());
  }

  async recordApprovedPublication(
    state: DocumentationWorkspaceState,
    publication: ApprovedDocumentationPublication,
  ): Promise<RepositoryResult<void>> {
    state.approvedPublication = publication;
    return await this.#writeState(state);
  }

  async createApprovedCommit(input: {
    state: DocumentationWorkspaceState;
    branch: string;
    message: string;
    changedFiles: string[];
  }): Promise<RepositoryResult<DocumentationCommit>> {
    const existingBranch = await this.#run(
      `git -C ${quoteShellArgument(input.state.path)} rev-parse --verify --quiet ${quoteShellArgument(`refs/heads/${input.branch}`)}`,
    );
    if (existingBranch.exitCode === 0) {
      if (existingBranch.stdout.trim() !== input.state.baseCommitSha) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `Local branch ${input.branch} already points at a different commit.`,
        ));
      }
      const switched = await this.#run(
        `git -C ${quoteShellArgument(input.state.path)} switch ${quoteShellArgument(input.branch)}`,
      );
      const switchedOk = switched.assertSucceeded(
        `Failed to reuse local branch ${input.branch}`,
      );
      if (switchedOk.isErr()) return err(switchedOk.error);
    } else if (existingBranch.exitCode === 1) {
      const created = await this.#run(
        `git -C ${quoteShellArgument(input.state.path)} switch -c ${quoteShellArgument(input.branch)}`,
      );
      const createdOk = created.assertSucceeded(
        `Failed to create local branch ${input.branch}`,
      );
      if (createdOk.isErr()) return err(createdOk.error);
    } else {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect local branch ${input.branch}: ${existingBranch.failureSummary()}`,
      ));
    }

    const pathspec = input.changedFiles.map(quoteShellArgument).join(" ");
    const staged = await this.#run(
      `git -C ${quoteShellArgument(input.state.path)} add -A -- ${pathspec}`,
    );
    const stagedOk = staged.assertSucceeded(
      "Failed to stage approved documentation paths",
    );
    if (stagedOk.isErr()) return err(stagedOk.error);
    const stagedPaths = await this.#shell.readNullSeparated(
      `git -C ${quoteShellArgument(input.state.path)} diff --cached --name-only --no-renames -z ${quoteShellArgument(input.state.baseCommitSha)} --`,
      "Failed to verify staged documentation paths",
    );
    if (stagedPaths.isErr()) return err(stagedPaths.error);
    const actualPaths = stagedPaths.value.sort();
    if (!sameStrings(actualPaths, [...input.changedFiles].sort())) {
      return err(new RepositoryError(
        "REPOSITORY_APPROVAL_MISMATCH",
        "Git staging did not match the exact approved documentation paths.",
      ));
    }

    const committed = await this.#run(
      `git -C ${quoteShellArgument(input.state.path)} -c user.name=Paige -c user.email=paige@users.noreply.github.com commit --no-gpg-sign -m ${quoteShellArgument(input.message)}`,
    );
    const committedOk = committed.assertSucceeded(
      "Failed to commit approved documentation changes",
    );
    if (committedOk.isErr()) return err(committedOk.error);
    const commitSha = await this.#readCommand(
      `git -C ${quoteShellArgument(input.state.path)} rev-parse HEAD`,
      "Failed to resolve the documentation commit SHA",
    );
    return commitSha.map((value) => ({
      branch: input.branch,
      commitSha: value,
      baseCommitSha: input.state.baseCommitSha,
    }));
  }

  async readApprovedCommit(input: {
    state: DocumentationWorkspaceState;
    approval: ApprovedDocumentationPublication;
  }): Promise<RepositoryResult<DocumentationCommit | undefined>> {
    const branch = await this.#run(
      `git -C ${quoteShellArgument(input.state.path)} rev-parse --verify --quiet ${quoteShellArgument(`refs/heads/${input.approval.branch}`)}`,
    );
    if (branch.exitCode === 1) return ok(undefined);
    if (branch.exitCode !== 0) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect local branch ${input.approval.branch}: ${branch.failureSummary()}`,
      ));
    }
    const commitSha = branch.stdout.trim();
    if (commitSha === input.state.baseCommitSha) return ok(undefined);

    const [head, status, parent, message] = await Promise.all([
      this.#readCommand(
        `git -C ${quoteShellArgument(input.state.path)} rev-parse HEAD`,
        "Failed to inspect documentation workspace HEAD",
      ),
      this.#readCommand(
        `git -C ${quoteShellArgument(input.state.path)} status --porcelain=v1`,
        "Failed to inspect documentation workspace status",
      ),
      this.#readCommand(
        `git -C ${quoteShellArgument(input.state.path)} rev-parse ${quoteShellArgument(`${commitSha}^`)}`,
        "Failed to inspect the documentation commit parent",
      ),
      this.#readCommand(
        `git -C ${quoteShellArgument(input.state.path)} log -1 --format=%B ${quoteShellArgument(commitSha)}`,
        "Failed to inspect the documentation commit message",
      ),
    ]);
    const combined = Result.combine([head, status, parent, message]);
    if (combined.isErr()) return err(combined.error);
    if (
      (combined.value[0] !== commitSha &&
        combined.value[0] !== input.state.baseCommitSha) ||
      combined.value[1] !== "" ||
      combined.value[2] !== input.state.baseCommitSha ||
      combined.value[3] !== input.approval.commitMessage
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Local branch ${input.approval.branch} is not the approved idempotent writeback state.`,
      ));
    }
    const inspected = await this.inspectCommit(input.state, commitSha);
    if (inspected.isErr()) return err(inspected.error);
    if (inspected.value.digest !== input.approval.digest) {
      return err(new RepositoryError(
        "REPOSITORY_APPROVAL_MISMATCH",
        "The existing documentation commit does not match the approved diff digest.",
      ));
    }
    return ok({
      branch: input.approval.branch,
      commitSha,
      baseCommitSha: input.state.baseCommitSha,
    });
  }

  async inspectCommit(
    state: DocumentationWorkspaceState,
    commitSha: string,
  ): Promise<RepositoryResult<{
    digest: string;
    files: ProposedDocumentationFile[];
  }>> {
    const changed = await this.#shell.readNullSeparated(
      `git -C ${quoteShellArgument(state.path)} diff --name-only --no-renames -z ${quoteShellArgument(state.baseCommitSha)} ${quoteShellArgument(commitSha)} --`,
      "Failed to inspect committed documentation paths",
    );
    if (changed.isErr()) return err(changed.error);
    const changedFiles = changed.value.sort();
    if (changedFiles.length === 0 || changedFiles.length > MAX_DIFF_FILES) {
      return err(new RepositoryError(
        "REPOSITORY_APPROVAL_MISMATCH",
        "The existing documentation commit has an invalid changed-file set.",
      ));
    }
    const files: ProposedDocumentationFile[] = [];
    for (const path of changedFiles) {
      const mode = await this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} ls-tree ${quoteShellArgument(commitSha)} -- ${quoteShellArgument(path)}`,
        `Failed to inspect committed documentation mode: ${path}`,
      );
      if (mode.isErr()) return err(mode.error);
      if (mode.value.startsWith("120000 ")) {
        return err(new RepositoryError(
          "REPOSITORY_DIFF_REJECTED",
          `Documentation commits cannot include symlinks: ${path}`,
        ));
      }
      const binary = await this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} diff --numstat ${quoteShellArgument(state.baseCommitSha)} ${quoteShellArgument(commitSha)} -- ${quoteShellArgument(path)}`,
        `Failed to inspect committed documentation type: ${path}`,
      );
      if (binary.isErr()) return err(binary.error);
      if (binary.value.startsWith("-\t-")) {
        return err(new RepositoryError(
          "REPOSITORY_DIFF_REJECTED",
          `Documentation commits cannot include binary files: ${path}`,
        ));
      }
      const object = `${commitSha}:${path}`;
      const exists = await this.#run(
        `git -C ${quoteShellArgument(state.path)} cat-file -e ${quoteShellArgument(object)}`,
      );
      if (exists.exitCode === 1 || exists.exitCode === 128) {
        files.push({ path, content: null });
        continue;
      }
      const existsOk = exists.assertSucceeded(
        `Failed to inspect committed documentation file: ${path}`,
      );
      if (existsOk.isErr()) return err(existsOk.error);
      const size = await this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} cat-file -s ${quoteShellArgument(object)}`,
        `Failed to inspect committed documentation size: ${path}`,
      );
      if (size.isErr()) return err(size.error);
      if (Number.parseInt(size.value, 10) > MAX_FILE_BYTES) {
        return err(new RepositoryError(
          "REPOSITORY_DIFF_REJECTED",
          `Committed documentation file is too large: ${path}`,
        ));
      }
      const content = await this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} show ${quoteShellArgument(object)}`,
        `Failed to read committed documentation file: ${path}`,
        { trim: false },
      );
      if (content.isErr()) return err(content.error);
      files.push({ path, content: content.value });
    }
    return ok({
      digest: createDocumentationDiffDigest(state.baseCommitSha, files),
      files,
    });
  }

  async #normalize(
    state: DocumentationWorkspaceState,
  ): Promise<RepositoryResult<DocumentationWorkspaceState>> {
    const [head, status] = await Promise.all([
      this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} rev-parse HEAD`,
        "Failed to inspect documentation workspace HEAD before normalization",
      ),
      this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} status --porcelain=v1`,
        "Failed to inspect documentation workspace status before normalization",
      ),
    ]);
    const inspected = Result.combine([head, status]);
    if (inspected.isErr()) return err(inspected.error);
    const [headValue, statusValue] = inspected.value;
    const branch = await this.#run(
      `git -C ${quoteShellArgument(state.path)} symbolic-ref --quiet --short HEAD`,
    );
    if (branch.exitCode !== 0 && branch.exitCode !== 1) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to inspect the documentation workspace branch: ${branch.failureSummary()}`,
      ));
    }
    const branchValue = branch.exitCode === 0
      ? branch.stdout.trim()
      : undefined;
    let branchToDetach = branchValue;
    const publication = state.approvedPublication;

    if (publication === undefined) {
      if (headValue !== state.baseCommitSha || branchValue !== undefined) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace contains an unknown branch or commit; refusing normalization.",
        ));
      }
      return ok(state);
    }
    if (branchValue !== undefined && branchValue !== publication.branch) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `The documentation workspace is on unknown branch ${branchValue}; refusing normalization.`,
      ));
    }

    if (headValue === state.baseCommitSha) {
      if (statusValue !== "") {
        const diff = await new DocumentationDraft({
          sandbox: this.#sandbox,
          state,
          abortSignal: this.#abortSignal,
        }).inspectDiff();
        if (
          diff.isErr() ||
          !diff.value.hasChanges ||
          diff.value.digest !== publication.digest
        ) {
          return err(new RepositoryError(
            "REPOSITORY_DIRTY_WORKSPACE",
            "The documentation workspace changed after approval; refusing to discard it during normalization.",
            { cause: diff.isErr() ? diff.error : undefined },
          ));
        }
        const committed = await this.createApprovedCommit({
          state,
          branch: publication.branch,
          message: publication.commitMessage,
          changedFiles: diff.value.changedFiles,
        });
        if (committed.isErr()) return err(committed.error);
        branchToDetach = publication.branch;
      }
    } else {
      if (statusValue !== "") {
        return err(new RepositoryError(
          "REPOSITORY_DIRTY_WORKSPACE",
          "The documentation workspace contains edits after its approved commit; refusing normalization.",
        ));
      }
      if (branchValue !== publication.branch) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace is not on its recorded publication branch; refusing normalization.",
        ));
      }
      const approvedCommit = await this.readApprovedCommit({
        state,
        approval: publication,
      });
      if (approvedCommit.isErr()) return err(approvedCommit.error);
      if (
        approvedCommit.value === undefined ||
        approvedCommit.value.commitSha !== headValue
      ) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "The documentation workspace commit does not match its recorded approved publication.",
        ));
      }
    }

    if (branchToDetach !== undefined) {
      const detached = await this.#run(
        `git -C ${quoteShellArgument(state.path)} switch --detach ${quoteShellArgument(state.baseCommitSha)}`,
      );
      const detachedOk = detached.assertSucceeded(
        "Failed to restore the documentation workspace to its recorded base",
      );
      if (detachedOk.isErr()) return err(detachedOk.error);
    }
    const [restoredHead, restoredStatus] = await Promise.all([
      this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} rev-parse HEAD`,
        "Failed to verify documentation workspace HEAD after normalization",
      ),
      this.#readCommand(
        `git -C ${quoteShellArgument(state.path)} status --porcelain=v1`,
        "Failed to verify documentation workspace status after normalization",
      ),
    ]);
    const restored = Result.combine([restoredHead, restoredStatus]);
    if (restored.isErr()) return err(restored.error);
    if (
      restored.value[0] !== state.baseCommitSha ||
      restored.value[1] !== ""
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation workspace did not return to its clean recorded base.",
      ));
    }
    delete state.approvedPublication;
    const persisted = await this.#writeState(state);
    if (persisted.isErr()) return err(persisted.error);
    return ok(state);
  }

  async #readState(
    repository: DocumentationRepository,
  ): Promise<RepositoryResult<DocumentationWorkspaceState>> {
    let contents: string;
    try {
      const stored = await this.#sandbox.readTextFile({
        path: workspaceStatePath(repository),
        abortSignal: this.#abortSignal,
      });
      if (stored === null) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          "Prepare the documentation workspace before using it.",
        ));
      }
      contents = stored;
    } catch (cause) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "Prepare the documentation workspace before using it.",
        { cause },
      ));
    }
    return parseWorkspaceState(contents);
  }

  async #writeState(
    state: DocumentationWorkspaceState,
  ): Promise<RepositoryResult<void>> {
    try {
      await this.#sandbox.writeTextFile({
        path: workspaceStatePath(state.repository),
        content: `${JSON.stringify(state)}\n`,
        abortSignal: this.#abortSignal,
      });
      return ok(undefined);
    } catch (cause) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        "Failed to persist documentation workspace recovery metadata.",
        { cause },
      ));
    }
  }

  async #createWorktree(
    cache: RepositoryWorkspace<DocumentationRepository>,
  ): Promise<RepositoryResult<void>> {
    const path = worktreePath(cache.repository);
    const root = await this.#run(
      `mkdir -p ${quoteShellArgument(WORKTREE_ROOT)}`,
    );
    const rootOk = root.assertSucceeded(
      "Failed to create the documentation worktree root",
    );
    if (rootOk.isErr()) return err(rootOk.error);
    const pruned = await this.#run(
      `git -C ${quoteShellArgument(cache.path)} worktree prune`,
    );
    const prunedOk = pruned.assertSucceeded(
      "Failed to prune stale documentation worktrees",
    );
    if (prunedOk.isErr()) return err(prunedOk.error);
    const result = await this.#run(
      `git -C ${quoteShellArgument(cache.path)} worktree add --detach ${quoteShellArgument(path)} ${quoteShellArgument(cache.repository.commitSha)}`,
    );
    return result.assertSucceeded(
      "Failed to create documentation worktree",
    );
  }

  async #verifyIdentity(input: {
    path: string;
    cachePath: string;
    repository:
      | DocumentationRepository
      | ResolvedRepository<DocumentationRepository>;
  }): Promise<RepositoryResult<void>> {
    const [root, remote, worktreeGitDirectory, cacheGitDirectory] =
      await Promise.all([
        this.#readCommand(
          `git -C ${quoteShellArgument(input.path)} rev-parse --show-toplevel`,
          "Failed to resolve the documentation worktree root",
        ),
        this.#readCommand(
          `git -C ${quoteShellArgument(input.path)} remote get-url origin`,
          "Failed to resolve the documentation worktree origin",
        ),
        this.#readCommand(
          `cd ${quoteShellArgument(input.path)} && cd "$(git rev-parse --git-common-dir)" && pwd -P`,
          "Failed to resolve the documentation worktree Git directory",
        ),
        this.#readCommand(
          `cd ${quoteShellArgument(input.cachePath)} && cd "$(git rev-parse --git-common-dir)" && pwd -P`,
          "Failed to resolve the repository cache Git directory",
        ),
      ]);
    const combined = Result.combine([
      root,
      remote,
      worktreeGitDirectory,
      cacheGitDirectory,
    ]);
    if (combined.isErr()) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation path is not the expected Git worktree.",
        { cause: combined.error },
      ));
    }
    const [rootValue, remoteValue, worktreeGitValue, cacheGitValue] =
      combined.value;
    if (
      rootValue !== input.path ||
      remoteValue !== githubRemoteUrl(input.repository) ||
      worktreeGitValue !== cacheGitValue
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        "The documentation worktree identity does not match the configured repository cache.",
      ));
    }
    return ok(undefined);
  }

  async #pathExists(path: string): Promise<boolean> {
    return await this.#shell.pathExists(path);
  }

  async #readCommand(
    command: string,
    message: string,
    options: { trim?: boolean } = {},
  ): Promise<RepositoryResult<string>> {
    return await this.#shell.read(command, message, options);
  }

  async #run(command: string): Promise<DocumentationSandboxCommand> {
    return await this.#shell.run(command);
  }
}

function assertStateMatchesRepository(
  state: DocumentationWorkspaceState,
  repository: DocumentationRepository,
): RepositoryResult<void> {
  if (
    state.repository.id !== repository.id ||
    state.repository.owner !== repository.owner ||
    state.repository.name !== repository.name ||
    state.repository.role !== "documentation" ||
    state.path !== worktreePath(repository) ||
    state.cachePath !== repositoryCachePath(repository)
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata does not match the configured repository.",
    ));
  }
  return ok(undefined);
}

function parseWorkspaceState(
  value: string,
): RepositoryResult<DocumentationWorkspaceState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata is invalid.",
      { cause },
    ));
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata is invalid.",
    ));
  }
  const state = parsed as Partial<DocumentationWorkspaceState>;
  const repository = state.repository;
  const publication = state.approvedPublication;
  if (
    typeof state.path !== "string" ||
    typeof state.cachePath !== "string" ||
    typeof state.baseBranch !== "string" ||
    typeof state.baseCommitSha !== "string" ||
    typeof repository !== "object" ||
    repository === null ||
    repository.role !== "documentation" ||
    typeof repository.id !== "string" ||
    typeof repository.owner !== "string" ||
    typeof repository.name !== "string" ||
    typeof repository.isPrivate !== "boolean" ||
    typeof repository.ref !== "string" ||
    typeof repository.commitSha !== "string" ||
    (
      publication !== undefined &&
      (
        typeof publication !== "object" ||
        publication === null ||
        typeof publication.digest !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(publication.digest) ||
        typeof publication.branch !== "string" ||
        !isValidPaigeBranch(publication.branch) ||
        typeof publication.commitMessage !== "string" ||
        publication.commitMessage === "" ||
        publication.commitMessage.length > 200 ||
        publication.commitMessage.includes("\n")
      )
    )
  ) {
    return err(new RepositoryError(
      "REPOSITORY_CONFLICT",
      "The documentation workspace metadata is incomplete.",
    ));
  }
  return ok(state as DocumentationWorkspaceState);
}

function toDocumentationWorkspace(
  state: DocumentationWorkspaceState,
): DocumentationWorkspaceOutput {
  return {
    path: state.path,
    repository: state.repository,
    baseBranch: state.baseBranch,
    baseCommitSha: state.baseCommitSha,
  };
}

function worktreePath(repository: DocumentationRepository): string {
  return `${WORKTREE_ROOT}/${repository.id}`;
}

function workspaceStatePath(repository: DocumentationRepository): string {
  return `${WORKTREE_ROOT}/.${repository.id}.json`;
}

function repositoryCachePath(repository: DocumentationRepository): string {
  return `/workspace/repositories/${repository.id}`;
}

function githubRemoteUrl(repository: RepositoryConfig): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
