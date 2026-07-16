import type { RepositoryResultAsync } from "../shared/errors";
import type {
  DocumentationCommit,
  DocumentationDiff,
  DocumentationPullRequest,
  DocumentationWorkspace,
} from "./types";

/**
 * Contract for the future writable documentation repository capability.
 *
 * Why this is separate from the evidence repository:
 *
 * Evidence repositories answer "what does the product currently do?" They are
 * immutable tarball snapshots at resolved commit SHAs. That representation is
 * intentionally cheap, attributable, and incapable of pushing changes, but it
 * has no `.git` history or index and therefore cannot safely support editing,
 * conflict detection, branch creation, commits, or pull requests.
 *
 * The documentation repository answers a different question: "what change
 * should Paige propose to the maintained documentation?" It needs a real Git
 * working tree so Paige can anchor edits to an observed base revision, inspect
 * the exact diff, detect upstream movement, and publish only the approved
 * patch. Keeping this capability separate prevents read-only product evidence
 * from accidentally becoming writable or entering a documentation commit.
 *
 * Implementation invariants:
 *
 * - Materialize only the configured documentation repository. Never accept
 *   model-supplied owner/name coordinates.
 * - Use a real Git checkout with `.git`; do not reuse or promote an evidence
 *   tarball checkout.
 * - Record the immutable base commit before edits. Every later diff, branch,
 *   commit, and PR must be traceable to that base.
 * - Keep GitHub credentials in the trusted app runtime. Prefer credential
 *   injection for individual fetch/push operations; never write tokens into
 *   the checkout, Git config, command output, or tool results.
 * - Let editing and diff inspection remain non-publishing operations. Branch
 *   creation, commit, push, and PR creation must sit behind explicit approval.
 * - Before writeback, verify the remote base has not moved incompatibly. Return
 *   a typed conflict instead of silently rebasing or overwriting upstream work.
 * - Bound the diff by file count and patch size, reject symlinks and paths
 *   outside the checkout, and expose the full approved file list.
 * - Commit only paths present in the approved diff. Ignore unrelated sandbox
 *   files and never include evidence repository content.
 * - Use a Paige-owned branch namespace, create a draft PR, and make repeated
 *   execution idempotent so Eve retries cannot create duplicate branches,
 *   commits, or pull requests.
 * - Preserve aborts and unexpected runtime failures as rejections. Represent
 *   expected Git, GitHub, validation, and conflict failures as typed Results.
 *
 * The eventual Eve surface will likely need separate tools for workspace/diff
 * operations and approval-gated writeback. Do not expose this interface as one
 * broad tool that can inspect and publish in the same unreviewed call.
 */
export interface DocumentationRepositoryService {
  /**
   * Create or refresh the writable Git working tree at the configured default
   * branch, resolve HEAD to an immutable SHA, and return that SHA as
   * `baseRevision`. Reuse is allowed only when checkout metadata and Git state
   * prove the workspace still represents the same repository and clean base.
   *
   * TODO: define the workspace path, authenticated fetch strategy, cache
   * validation, cleanup behavior, and response when an earlier workspace
   * contains uncommitted edits.
   */
  prepareWorkspace(): RepositoryResultAsync<DocumentationWorkspace>;

  /**
   * Return the bounded patch Paige is proposing relative to `baseRevision`.
   * Include all changed paths, detect untracked files, reject unsupported file
   * types and repository escapes, and return a clean/no-change result without
   * manufacturing a commit.
   *
   * TODO: define patch/file limits and whether binary files are rejected or
   * represented only as metadata.
   */
  inspectDiff(): RepositoryResultAsync<DocumentationDiff>;

  /**
   * After explicit approval, verify that the current workspace still matches
   * the inspected diff and base revision, create a Paige-owned branch, stage
   * exactly the approved paths, and create one commit with the approved
   * message. This phase must not include unrelated working-tree changes.
   *
   * TODO: add an approval artifact or diff digest to the input so implementation
   * can prove that the committed bytes are the same bytes the user reviewed.
   */
  createCommit(input: {
    branch: string;
    message: string;
  }): RepositoryResultAsync<DocumentationCommit>;

  /**
   * Push the approved commit and create or reuse a draft pull request targeting
   * the configured base branch. The PR should cite the base revision and expose
   * the resulting GitHub URL; it must never auto-merge.
   *
   * TODO: define branch collision handling, retry/idempotency keys, PR body
   * provenance, and the behavior when the remote default branch advanced after
   * approval.
   */
  openDraftPullRequest(input: {
    commit: DocumentationCommit;
    title: string;
    body: string;
  }): RepositoryResultAsync<DocumentationPullRequest>;
}

export const documentationRepositoryTodos = [
  "materialize-real-git-checkout",
  "edit-only-configured-documentation-repository",
  "generate-bounded-diff",
  "require-explicit-writeback-approval",
  "create-branch-and-commit-from-base-revision",
  "push-and-open-draft-pull-request",
] as const;
