export interface GitHubRepository {
  id: string;
  owner: string;
  name: string;
}

export type ResolvedRepository<
  TRepository extends GitHubRepository = GitHubRepository,
> = TRepository & {
  ref: string;
  resolvedRevision: string;
};

export interface RepositoryCheckout<
  TRepository extends GitHubRepository = GitHubRepository,
> {
  path: string;
  repository: ResolvedRepository<TRepository>;
}
