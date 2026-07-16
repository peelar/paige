import { err, ok } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResult } from "../shared/errors";
import type { EvidenceRepository } from "./types";

export const evidenceRepositories = [
  {
    id: "saleor-core",
    owner: "saleor",
    name: "saleor",
    type: "evidence",
    access: "public",
  },
  {
    id: "saleor-dashboard",
    owner: "saleor",
    name: "saleor-dashboard",
    type: "evidence",
    access: "public",
  },
  {
    id: "saleor-apps",
    owner: "saleor",
    name: "apps",
    type: "evidence",
    access: "public",
  },
] satisfies EvidenceRepository[];

/** Returns the evidence repositories Paige is explicitly allowed to inspect. */
export function catalogEvidenceRepositories(
  config: EvidenceRepository[] = evidenceRepositories,
): EvidenceRepository[] {
  return [...config];
}

/** Resolves a model-facing repository ID without accepting arbitrary origins. */
export function resolveConfiguredEvidenceRepository(
  config: EvidenceRepository[],
  repositoryId: string,
): RepositoryResult<EvidenceRepository> {
  const repository = catalogEvidenceRepositories(config).find(
    (candidate) => candidate.id === repositoryId,
  );
  if (repository === undefined) {
    return err(new RepositoryError(
      "REPOSITORY_NOT_CONFIGURED",
      `Evidence repository is not configured: ${repositoryId}`,
    ));
  }
  return ok(repository);
}
