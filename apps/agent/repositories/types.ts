export interface RepositoryConfig {
  id: string;
  owner: string;
  name: string;
  role: "documentation" | "evidence";
  /**
   * Older saved configurations have no access value. Treat those as
   * installation-backed so an upgrade never broadens private repository access.
   */
  access?: "public" | "installation";
}

export type DocumentationRepository = RepositoryConfig & {
  role: "documentation";
};

export type ResolvedRepository<
  TRepository extends RepositoryConfig = RepositoryConfig,
> = TRepository & {
  isPrivate: boolean;
  ref: string;
  commitSha: string;
};

export interface RepositoryWorkspace<
  TRepository extends RepositoryConfig = RepositoryConfig,
> {
  path: string;
  repository: ResolvedRepository<TRepository>;
}

export interface RepositorySearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

export interface RepositoryComparison {
  repositoryId: string;
  baseCommitSha: string;
  headCommitSha: string;
  changedFiles: string[];
  truncated: boolean;
}
