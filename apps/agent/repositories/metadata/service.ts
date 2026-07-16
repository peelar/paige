import type { RepositoryResultAsync } from "../shared/errors";
import type {
  RepositoryCommitSummary,
  RepositoryComparison,
  RepositoryComparisonQuery,
  RepositoryIssue,
  RepositoryMetadataQuery,
  RepositoryPullRequest,
  RepositoryRelease,
  RepositoryTag,
} from "./types";

/**
 * Contract for bounded GitHub metadata reads.
 *
 * TODO: implement this as a separate read-only API-backed tool. Responses must
 * use configured repository IDs, enforce limits, preserve source URLs and
 * timestamps, and keep release/issue/PR data out of sandbox shell commands.
 */
export interface RepositoryMetadataService {
  listReleases(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryRelease[]>;
  listOpenIssues(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryIssue[]>;
  listOpenPullRequests(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryPullRequest[]>;
  listTags(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryTag[]>;
  listCommits(
    input: RepositoryMetadataQuery,
  ): RepositoryResultAsync<RepositoryCommitSummary[]>;
  compareRevisions(
    input: RepositoryComparisonQuery,
  ): RepositoryResultAsync<RepositoryComparison>;
}

export const repositoryMetadataTodos = [
  "list-releases",
  "list-open-issues",
  "list-open-pull-requests",
  "list-tags",
  "list-commits",
  "compare-revisions-and-list-changed-files",
] as const;
