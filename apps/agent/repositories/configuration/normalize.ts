import { err, ok, Result } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResult } from "../shared/errors";
import type {
  DocumentationRepository,
  RepositoryConfig,
} from "../types";
import type { RepositoryConfigurationData } from "./types";

const GITHUB_HOST = "github.com";
const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function normalizeRepositoryConfiguration(input: {
  documentationRepositoryUrl: string;
  evidenceRepositoryUrls?: string[];
}): RepositoryResult<RepositoryConfigurationData> {
  return Result.combine([
    normalizeGitHubRepository(
      input.documentationRepositoryUrl,
      "documentation",
    ),
    Result.combine(
      (input.evidenceRepositoryUrls ?? []).map((url) =>
        normalizeGitHubRepository(url, "evidence")
      ),
    ),
  ]).map(([documentationRepository, evidenceRepositories]) => ({
    documentationRepository,
    evidenceRepositories: deduplicateEvidenceRepositories(
      documentationRepository,
      evidenceRepositories,
    ),
  }));
}

export function normalizeGitHubRepository<
  TRole extends RepositoryConfig["role"],
>(
  value: string,
  role: TRole,
): RepositoryResult<RepositoryConfig & { role: TRole }> {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (cause) {
    return err(invalidGitHubUrl(trimmed, cause));
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== GITHUB_HOST ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return err(invalidGitHubUrl(trimmed));
  }

  const segments = url.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  if (segments.length !== 2) {
    return err(invalidGitHubUrl(trimmed));
  }

  const owner = segments[0];
  const name = segments[1].replace(/\.git$/i, "");
  if (
    owner.length === 0 ||
    name.length === 0 ||
    !REPOSITORY_SEGMENT_PATTERN.test(owner) ||
    !REPOSITORY_SEGMENT_PATTERN.test(name)
  ) {
    return err(invalidGitHubUrl(trimmed));
  }

  const normalizedOwner = owner.toLowerCase();
  const normalizedName = name.toLowerCase();
  return ok({
    id: `${normalizedOwner}--${normalizedName}`,
    owner: normalizedOwner,
    name: normalizedName,
    role,
  });
}

function deduplicateEvidenceRepositories(
  documentationRepository: DocumentationRepository,
  evidenceRepositories: RepositoryConfig[],
): RepositoryConfig[] {
  const documentationKey = repositoryKey(documentationRepository);
  const seen = new Set<string>([documentationKey]);

  return evidenceRepositories.filter((repository) => {
    const key = repositoryKey(repository);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function repositoryKey(repository: RepositoryConfig): string {
  return `${repository.owner}/${repository.name}`.toLowerCase();
}

function invalidGitHubUrl(value: string, cause?: unknown): RepositoryError {
  return new RepositoryError(
    "REPOSITORY_INVALID_INPUT",
    `Use a GitHub repository URL like https://github.com/owner/repository: ${value}`,
    cause === undefined ? undefined : { cause },
  );
}
