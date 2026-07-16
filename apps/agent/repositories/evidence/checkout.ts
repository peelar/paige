import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "../shared/errors";
import {
  downloadRepositoryArchive,
  resolveGitHubRevision,
} from "../shared/github";
import type {
  RepositoryCheckout,
  ResolvedRepository,
} from "../shared/types";
import type { EvidenceRepository } from "./types";

const REPOSITORY_PATH_PREFIX = "/workspace/evidence-repositories";
const CHECKOUT_METADATA_SUFFIX = ".paige.json";

/**
 * Resolves an evidence repository revision and makes that exact snapshot
 * available in the sandbox, reusing it while its metadata still matches.
 */
export function ensureEvidenceRepositoryCheckout(input: {
  sandbox: SandboxSession;
  repository: EvidenceRepository;
  getGitHubToken: () => RepositoryResultAsync<string | undefined>;
  abortSignal: AbortSignal;
}): RepositoryResultAsync<RepositoryCheckout<EvidenceRepository>> {
  return new ResultAsync((async () => {
    const path = `${REPOSITORY_PATH_PREFIX}/${input.repository.id}`;
    const token = await input.getGitHubToken();
    if (token.isErr()) return err(token.error);
    const repository = await resolveGitHubRevision(
      input.repository,
      token.value,
      input.abortSignal,
    );
    if (repository.isErr()) return err(repository.error);
    const metadataPath = `${path}${CHECKOUT_METADATA_SUFFIX}`;
    const existingMetadata = await input.sandbox.readTextFile({
      path: metadataPath,
      abortSignal: input.abortSignal,
    });
    if (isCurrentCheckout(existingMetadata, repository.value)) {
      return ok({ path, repository: repository.value });
    }

    const archivePath = `${REPOSITORY_PATH_PREFIX}/.${input.repository.id}-${repository.value.resolvedRevision.slice(0, 12)}.tar.gz`;
    const stagingPath = `${path}.staging`;
    const archive = await downloadRepositoryArchive(
      repository.value,
      token.value,
      input.abortSignal,
    );
    if (archive.isErr()) return err(archive.error);
    await input.sandbox.writeFile({
      path: archivePath,
      content: archive.value,
      abortSignal: input.abortSignal,
    });

    let extractionResult: SandboxCommandResult;
    try {
      await input.sandbox.removePath({
        path: stagingPath,
        force: true,
        recursive: true,
        abortSignal: input.abortSignal,
      });
      extractionResult = await input.sandbox.run({
        command: `mkdir -p ${quoteShellArgument(stagingPath)} && tar -xzf ${quoteShellArgument(archivePath)} -C ${quoteShellArgument(stagingPath)} --strip-components=1 --no-same-owner --no-same-permissions && find ${quoteShellArgument(stagingPath)} -type l -delete`,
        abortSignal: input.abortSignal,
      });
    } finally {
      await input.sandbox.removePath({
        path: archivePath,
        force: true,
        abortSignal: input.abortSignal,
      });
    }

    if (extractionResult.exitCode !== 0) {
      await input.sandbox.removePath({
        path: stagingPath,
        force: true,
        recursive: true,
        abortSignal: input.abortSignal,
      });
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Failed to materialize repository ${input.repository.id}: ${summarizeCommandFailure(extractionResult)}`,
      ));
    }

    await input.sandbox.removePath({
      path,
      force: true,
      recursive: true,
      abortSignal: input.abortSignal,
    });
    const promoteResult = await input.sandbox.run({
      command: `mv ${quoteShellArgument(stagingPath)} ${quoteShellArgument(path)}`,
      abortSignal: input.abortSignal,
    });
    const promoted = successfulCommand(
      promoteResult,
      `Failed to activate repository ${input.repository.id}`,
    );
    if (promoted.isErr()) return err(promoted.error);
    await input.sandbox.writeTextFile({
      path: metadataPath,
      content: `${JSON.stringify(repository.value)}\n`,
      abortSignal: input.abortSignal,
    });

    return ok({ path, repository: repository.value });
  })());
}

function isCurrentCheckout(
  value: string | null,
  repository: ResolvedRepository<EvidenceRepository>,
): boolean {
  // Metadata is the trust boundary for cache reuse. Missing, malformed, or
  // partially matching metadata forces a fresh archive materialization.
  if (value === null) return false;
  try {
    const metadata = JSON.parse(value) as Partial<ResolvedRepository>;
    return (
      metadata.owner === repository.owner &&
      metadata.name === repository.name &&
      metadata.ref === repository.ref &&
      metadata.resolvedRevision === repository.resolvedRevision
    );
  } catch {
    return false;
  }
}

function successfulCommand(
  result: SandboxCommandResult,
  message: string,
): RepositoryResult<void> {
  if (result.exitCode !== 0) {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `${message}: ${summarizeCommandFailure(result)}`,
    ));
  }
  return ok(undefined);
}

function summarizeCommandFailure(result: SandboxCommandResult): string {
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `command exited with ${result.exitCode}`
  ).slice(0, 1_000);
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
