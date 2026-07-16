import { err, ok } from "neverthrow";

import { assertRepositoryRelativePath } from "../files";
import type { RepositoryResult } from "../shared/errors";
import { RepositoryError } from "../shared/errors";
import type { GitHubRepository } from "../shared/github";
import type { DocumentationRepository } from "../types";
import { createDocumentationDiffDigest, DocumentationDraft } from "./draft";
import type {
  DocumentationCommit,
  DocumentationWorkspaceState,
  DocumentationWriteback,
  DocumentationWritebackInput,
  ProposedDocumentationFile,
} from "./types";
import { DocumentationWorkspace } from "./workspace";

const MAX_FILE_BYTES = 1_000_000;
const MAX_DIFF_FILES = 50;

export class DocumentationPublisher {
  readonly #state: DocumentationWorkspaceState;
  readonly #workspace: DocumentationWorkspace;
  readonly #draft: DocumentationDraft;
  readonly #github: GitHubRepository<DocumentationRepository>;

  constructor(input: {
    state: DocumentationWorkspaceState;
    workspace: DocumentationWorkspace;
    draft: DocumentationDraft;
    github: GitHubRepository<DocumentationRepository>;
  }) {
    this.#state = input.state;
    this.#workspace = input.workspace;
    this.#draft = input.draft;
    this.#github = input.github;
  }

  async publish(
    input: DocumentationWritebackInput,
  ): Promise<RepositoryResult<DocumentationWriteback>> {
    const approval = {
      digest: input.digest,
      branch: input.branch,
      commitMessage: input.commitMessage,
    };
    const existingCommit = await this.#workspace.readApprovedCommit({
      state: this.#state,
      approval,
    });
    if (existingCommit.isErr()) return err(existingCommit.error);

    let remoteBranchCommitSha: string | undefined;
    let remoteBranchWasChecked = false;
    if (existingCommit.value !== undefined) {
      const remoteBranch = await this.#github.resolveBranchCommitSha(
        existingCommit.value.branch,
      );
      if (remoteBranch.isErr()) return err(remoteBranch.error);
      remoteBranchCommitSha = remoteBranch.value;
      remoteBranchWasChecked = true;
      if (
        remoteBranchCommitSha !== undefined &&
        remoteBranchCommitSha !== this.#state.baseCommitSha
      ) {
        const published = await this.#verifyPublishedCommit({
          branch: existingCommit.value.branch,
          commitSha: remoteBranchCommitSha,
          digest: input.digest,
          message: input.commitMessage,
        });
        if (published.isErr()) return err(published.error);
        const existingPullRequest = await this.#github.findDraftPullRequest({
          branch: existingCommit.value.branch,
          baseBranch: this.#state.baseBranch,
          title: input.pullRequestTitle,
          body: input.pullRequestBody,
        });
        if (existingPullRequest.isErr()) {
          return err(existingPullRequest.error);
        }
        if (existingPullRequest.value !== undefined) {
          return ok({
            commit: published.value,
            pullRequest: existingPullRequest.value,
            reused: true,
          });
        }
      }
    }

    let changedFiles: string[] | undefined;
    if (existingCommit.value === undefined) {
      const diff = await this.#draft.inspectDiff();
      if (diff.isErr()) return err(diff.error);
      if (!diff.value.hasChanges || diff.value.digest === null) {
        return err(new RepositoryError(
          "REPOSITORY_APPROVAL_MISMATCH",
          "The approved documentation diff no longer contains changes.",
        ));
      }
      if (diff.value.digest !== input.digest) {
        return err(new RepositoryError(
          "REPOSITORY_APPROVAL_MISMATCH",
          "The documentation workspace no longer matches the approved diff digest.",
        ));
      }
      changedFiles = diff.value.changedFiles;
    }

    const recorded = await this.#workspace.recordApprovedPublication(
      this.#state,
      approval,
    );
    if (recorded.isErr()) return err(recorded.error);

    const remoteBase = await this.#github.resolveCommit();
    if (remoteBase.isErr()) return err(remoteBase.error);
    if (
      remoteBase.value.ref !== this.#state.baseBranch ||
      remoteBase.value.commitSha !== this.#state.baseCommitSha
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `The remote base ${this.#state.baseBranch} moved after the documentation diff was prepared.`,
      ));
    }

    let commit = existingCommit.value;
    if (commit === undefined) {
      if (changedFiles === undefined) {
        return err(new RepositoryError(
          "REPOSITORY_APPROVAL_MISMATCH",
          "The approved documentation diff is unavailable.",
        ));
      }
      const created = await this.#workspace.createApprovedCommit({
        state: this.#state,
        branch: input.branch,
        message: input.commitMessage,
        changedFiles,
      });
      if (created.isErr()) return err(created.error);
      commit = created.value;
    }

    const committed = await this.#workspace.inspectCommit(
      this.#state,
      commit.commitSha,
    );
    if (committed.isErr()) return err(committed.error);
    if (committed.value.digest !== input.digest) {
      return err(new RepositoryError(
        "REPOSITORY_APPROVAL_MISMATCH",
        "The committed documentation bytes do not match the approved diff digest.",
      ));
    }

    if (!remoteBranchWasChecked) {
      const remoteBranch = await this.#github.resolveBranchCommitSha(
        commit.branch,
      );
      if (remoteBranch.isErr()) return err(remoteBranch.error);
      remoteBranchCommitSha = remoteBranch.value;
    }
    const published = await this.#publishCommit({
      commit,
      remoteBranchCommitSha,
      digest: input.digest,
      message: input.commitMessage,
      files: committed.value.files,
    });
    if (published.isErr()) return err(published.error);
    const reused =
      existingCommit.value !== undefined ||
      remoteBranchCommitSha !== undefined;

    const pullRequest = await this.#github.createOrReuseDraftPullRequest({
      branch: published.value.branch,
      baseBranch: this.#state.baseBranch,
      title: input.pullRequestTitle,
      body: input.pullRequestBody,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    return ok({
      commit: published.value,
      pullRequest: {
        number: pullRequest.value.number,
        url: pullRequest.value.url,
        draft: true,
      },
      reused: reused || pullRequest.value.reused,
    });
  }

  async #publishCommit(input: {
    commit: DocumentationCommit;
    remoteBranchCommitSha: string | undefined;
    digest: string;
    message: string;
    files: ProposedDocumentationFile[];
  }): Promise<RepositoryResult<DocumentationCommit>> {
    let remoteCommitSha = input.remoteBranchCommitSha;
    if (remoteCommitSha === undefined) {
      const created = await this.#github.createBranch({
        branch: input.commit.branch,
        commitSha: this.#state.baseCommitSha,
      });
      if (created.isErr()) {
        const raced = await this.#github.resolveBranchCommitSha(
          input.commit.branch,
        );
        if (raced.isErr()) return err(raced.error);
        if (raced.value === undefined) return err(created.error);
        remoteCommitSha = raced.value;
      } else {
        remoteCommitSha = this.#state.baseCommitSha;
      }
    }
    if (remoteCommitSha === this.#state.baseCommitSha) {
      const created = await this.#github.createCommitOnBranch({
        branch: input.commit.branch,
        expectedHeadCommitSha: this.#state.baseCommitSha,
        message: input.message,
        files: input.files,
      });
      if (created.isErr()) return err(created.error);
      remoteCommitSha = created.value;
    }
    return await this.#verifyPublishedCommit({
      branch: input.commit.branch,
      commitSha: remoteCommitSha,
      digest: input.digest,
      message: input.message,
    });
  }

  async #verifyPublishedCommit(input: {
    branch: string;
    commitSha: string;
    digest: string;
    message: string;
  }): Promise<RepositoryResult<DocumentationCommit>> {
    const details = await this.#github.readCommitDetails(input.commitSha);
    if (details.isErr()) return err(details.error);
    if (
      details.value.parentSha !== this.#state.baseCommitSha ||
      details.value.message !== input.message
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Remote branch ${input.branch} does not contain the approved commit.`,
      ));
    }
    const files: ProposedDocumentationFile[] = [];
    for (const file of details.value.files) {
      const path = assertRepositoryRelativePath(file.path, {
        allowRoot: false,
      });
      if (path.isErr() || path.value !== file.path) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `Remote branch ${input.branch} contains an invalid path.`,
        ));
      }
      if (file.status === "renamed") {
        const previousPath = assertRepositoryRelativePath(
          file.previousPath ?? "",
          { allowRoot: false },
        );
        if (
          previousPath.isErr() ||
          previousPath.value !== file.previousPath
        ) {
          return err(new RepositoryError(
            "REPOSITORY_CONFLICT",
            `Remote branch ${input.branch} contains an invalid renamed path.`,
          ));
        }
        files.push({ path: previousPath.value, content: null });
      }
      if (file.status === "removed") {
        files.push({ path: path.value, content: null });
        continue;
      }
      const content = await this.#github.readTextFile({
        commitSha: input.commitSha,
        path: path.value,
      });
      if (content.isErr()) return err(content.error);
      if (Buffer.byteLength(content.value, "utf8") > MAX_FILE_BYTES) {
        return err(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `Remote branch ${input.branch} contains an oversized documentation file.`,
        ));
      }
      files.push({ path: path.value, content: content.value });
    }
    if (files.length === 0 || files.length > MAX_DIFF_FILES) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Remote branch ${input.branch} has an invalid changed-file set.`,
      ));
    }
    if (
      createDocumentationDiffDigest(this.#state.baseCommitSha, files) !==
        input.digest
    ) {
      return err(new RepositoryError(
        "REPOSITORY_CONFLICT",
        `Remote branch ${input.branch} does not match the approved documentation diff.`,
      ));
    }
    return ok({
      branch: input.branch,
      commitSha: input.commitSha,
      baseCommitSha: this.#state.baseCommitSha,
    });
  }
}

export function validateDocumentationWritebackInput(
  input: DocumentationWritebackInput,
): RepositoryResult<DocumentationWritebackInput> {
  const normalized = {
    digest: input.digest.trim(),
    branch: input.branch.trim(),
    commitMessage: input.commitMessage.trim(),
    pullRequestTitle: input.pullRequestTitle.trim(),
    pullRequestBody: input.pullRequestBody.trim(),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized.digest)) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use the exact sha256 documentation diff digest returned by inspect_diff.",
    ));
  }
  if (!isValidPaigeBranch(normalized.branch)) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use a valid deterministic branch in the paige/ namespace.",
    ));
  }
  if (
    normalized.commitMessage === "" ||
    normalized.commitMessage.length > 200 ||
    normalized.commitMessage.includes("\n") ||
    normalized.pullRequestTitle === "" ||
    normalized.pullRequestTitle.length > 200 ||
    normalized.pullRequestBody.length > 20_000
  ) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Approved commit and pull request metadata is missing, too large, or the commit message is not single-line.",
    ));
  }
  return ok(normalized);
}

function isValidPaigeBranch(value: string): boolean {
  return (
    /^paige\/[a-z0-9][a-z0-9._/-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    value.length <= 120
  );
}
