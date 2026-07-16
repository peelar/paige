import type { GitHubRepository } from "../shared/types";

export interface DocumentationRepository extends GitHubRepository {
  type: "documentation";
}

export const documentationRepository = {
  id: "saleor-docs",
  owner: "peelar",
  name: "saleor-docs",
  type: "documentation",
} satisfies DocumentationRepository;
