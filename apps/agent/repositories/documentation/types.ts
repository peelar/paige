import type { DocumentationRepository } from "./config";
import type { ResolvedRepository } from "../shared/types";

export interface DocumentationWorkspace {
  path: string;
  repository: ResolvedRepository<DocumentationRepository>;
  baseRevision: string;
}

export interface DocumentationDiff {
  baseRevision: string;
  patch: string;
  changedFiles: string[];
}

export interface DocumentationCommit {
  branch: string;
  commitSha: string;
  baseRevision: string;
}

export interface DocumentationPullRequest {
  number: number;
  url: string;
  draft: true;
}
