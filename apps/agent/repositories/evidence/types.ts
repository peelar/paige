import type { GitHubRepository } from "../shared/types";

export interface EvidenceRepository extends GitHubRepository {
  type: "evidence";
  access: "public" | "github-app";
}
