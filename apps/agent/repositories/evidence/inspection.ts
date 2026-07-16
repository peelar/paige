import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type {
  RepositoryResult,
  RepositoryResultAsync,
} from "../shared/errors";
import type {
  RepositoryCheckout,
  ResolvedRepository,
} from "../shared/types";
import type { EvidenceRepository } from "./types";

const MAX_READ_FILE_BYTES = 1_000_000;
const MAX_READ_LINES = 400;
const MAX_READ_CHARACTERS = 24_000;
const MAX_SEARCH_EXCERPT_CHARACTERS = 500;

export interface EvidenceRepositorySearchMatch {
  path: string;
  line: number;
  excerpt: string;
}

/** Lists repository files under a validated prefix with a bounded result set. */
export function listEvidenceRepositoryFiles(input: {
  sandbox: SandboxSession;
  checkout: RepositoryCheckout<EvidenceRepository>;
  abortSignal: AbortSignal;
  pathPrefix: string;
  limit: number;
}): RepositoryResultAsync<{
  repository: ResolvedRepository<EvidenceRepository>;
  files: string[];
  truncated: boolean;
}> {
  return new ResultAsync((async () => {
    const prefixFilter =
      input.pathPrefix === "."
        ? ""
        : ` | awk -v prefix=${quoteShellArgument(input.pathPrefix)} 'index($0, prefix) == 1'`;
    const result = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.checkout.path)} && find . -type f -print | sed 's#^\\./##'${prefixFilter} | LC_ALL=C sort | head -n ${input.limit + 1}`,
      input.abortSignal,
    );
    const successful = successfulInspection(
      result,
      "Repository file listing failed",
    );
    if (successful.isErr()) return err(successful.error);
    const files = result.stdout.split("\n").filter(Boolean);

    return ok({
      repository: input.checkout.repository,
      files: files.slice(0, input.limit),
      truncated: files.length > input.limit,
    });
  })());
}

/** Runs a literal-text repository search and returns bounded, parsed matches. */
export function searchEvidenceRepository(input: {
  sandbox: SandboxSession;
  checkout: RepositoryCheckout<EvidenceRepository>;
  abortSignal: AbortSignal;
  query: string;
  pathPrefix: string;
  limit: number;
}): RepositoryResultAsync<{
  repository: ResolvedRepository<EvidenceRepository>;
  matches: EvidenceRepositorySearchMatch[];
  truncated: boolean;
}> {
  return new ResultAsync((async () => {
    const pathArgument =
      input.pathPrefix === "." ? "." : `./${input.pathPrefix}`;
    const result = await run(
      input.sandbox,
      `cd ${quoteShellArgument(input.checkout.path)} && rg -n --with-filename --no-heading --color never --fixed-strings -- ${quoteShellArgument(input.query)} ${quoteShellArgument(pathArgument)} | head -n ${input.limit + 1} | cut -c 1-1000`,
      input.abortSignal,
    );
    const successful = successfulInspection(result, "Repository search failed");
    if (successful.isErr()) return err(successful.error);
    const matches = result.stdout
      .split("\n")
      .filter(Boolean)
      .map(parseSearchMatch)
      .filter((match): match is EvidenceRepositorySearchMatch => match !== null);

    return ok({
      repository: input.checkout.repository,
      matches: matches.slice(0, input.limit),
      truncated: matches.length > input.limit,
    });
  })());
}

/**
 * Reads a regular, non-symlink file and returns a bounded line selection plus
 * the blob SHA needed to cite the exact evidence that Paige inspected.
 */
export function readEvidenceRepositoryFile(input: {
  sandbox: SandboxSession;
  checkout: RepositoryCheckout<EvidenceRepository>;
  abortSignal: AbortSignal;
  path: string;
  startLine: number;
  endLine?: number;
  maxCharacters: number;
}): RepositoryResultAsync<{
  repository: ResolvedRepository<EvidenceRepository>;
  path: string;
  blobSha: string;
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
}> {
  return new ResultAsync((async () => {
    const absolutePath = `${input.checkout.path}/${input.path}`;
    const typeResult = await run(
      input.sandbox,
      `test -f ${quoteShellArgument(absolutePath)} && test ! -L ${quoteShellArgument(absolutePath)}`,
      input.abortSignal,
    );
    if (typeResult.exitCode !== 0) {
      return err(new RepositoryError(
        "REPOSITORY_FILE_NOT_FOUND",
        `Repository file does not exist: ${input.path}`,
      ));
    }

    const sizeResult = await run(
      input.sandbox,
      `wc -c < ${quoteShellArgument(absolutePath)}`,
      input.abortSignal,
    );
    const sizeSuccessful = successfulCommand(
      sizeResult,
      "Repository file size lookup failed",
    );
    if (sizeSuccessful.isErr()) return err(sizeSuccessful.error);
    const size = Number.parseInt(sizeResult.stdout.trim(), 10);
    if (!Number.isSafeInteger(size) || size < 0) {
      return err(new RepositoryError(
        "REPOSITORY_SANDBOX_FAILED",
        `Repository file size is invalid: ${input.path}`,
      ));
    }
    if (size > MAX_READ_FILE_BYTES) {
      return err(new RepositoryError(
        "REPOSITORY_INVALID_INPUT",
        `Repository file is too large to read: ${input.path}`,
      ));
    }

    const [content, hashResult] = await Promise.all([
      input.sandbox.readTextFile({
        path: absolutePath,
        abortSignal: input.abortSignal,
      }),
      run(
        input.sandbox,
        `git hash-object ${quoteShellArgument(absolutePath)}`,
        input.abortSignal,
      ),
    ]);
    const hashSuccessful = successfulCommand(
      hashResult,
      "Repository file hash lookup failed",
    );
    if (hashSuccessful.isErr()) return err(hashSuccessful.error);
    if (content === null) {
      return err(new RepositoryError(
        "REPOSITORY_FILE_NOT_FOUND",
        `Repository file does not exist: ${input.path}`,
      ));
    }

    const selection = selectFileLines(content, {
      startLine: input.startLine,
      endLine: input.endLine,
      maxCharacters: input.maxCharacters,
    });
    if (selection.isErr()) return err(selection.error);

    return ok({
      repository: input.checkout.repository,
      path: input.path,
      blobSha: hashResult.stdout.trim(),
      ...selection.value,
    });
  })());
}

/** Normalizes a path while preventing absolute paths and parent traversal. */
export function assertRepositoryRelativePath(
  value: string,
  options: { allowRoot: boolean },
): RepositoryResult<string> {
  const path = value.trim();
  if (options.allowRoot && (path === "." || path === "/")) return ok(".");
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("\n") ||
    path.includes("\r") ||
    path.split("/").includes("..") ||
    path === "."
  ) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Use a repository-relative path: ${value}`,
    ));
  }
  return ok(path.replace(/^\.\//, "") || ".");
}

/** Selects a bounded, 1-based line range and records whether content was omitted. */
export function selectFileLines(
  content: string,
  input: { startLine: number; endLine?: number; maxCharacters?: number },
): RepositoryResult<{
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
}> {
  const lines = content.split("\n");
  if (input.startLine > lines.length) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Start line ${input.startLine} is past the end of the file.`,
    ));
  }
  const requestedEndLine = input.endLine ?? input.startLine + MAX_READ_LINES - 1;
  if (requestedEndLine < input.startLine) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "End line must be greater than or equal to start line.",
    ));
  }
  if (requestedEndLine - input.startLine + 1 > MAX_READ_LINES) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      `Read at most ${MAX_READ_LINES} lines at a time.`,
    ));
  }

  const endLine = Math.min(requestedEndLine, lines.length);
  const selected = lines.slice(input.startLine - 1, endLine).join("\n");
  const maxCharacters = input.maxCharacters ?? MAX_READ_CHARACTERS;
  const characterTruncated = selected.length > maxCharacters;

  return ok({
    startLine: input.startLine,
    endLine,
    content: characterTruncated ? selected.slice(0, maxCharacters) : selected,
    truncated:
      input.startLine > 1 || endLine < lines.length || characterTruncated,
  });
}

/** Normalizes a literal search query and rejects multiline command input. */
export function assertSearchQuery(value: string): RepositoryResult<string> {
  const query = value.trim();
  if (
    query === "" ||
    query.includes("\0") ||
    query.includes("\n") ||
    query.includes("\r")
  ) {
    return err(new RepositoryError(
      "REPOSITORY_INVALID_INPUT",
      "Use a non-empty, single-line repository search query.",
    ));
  }
  return ok(query);
}

function parseSearchMatch(value: string): EvidenceRepositorySearchMatch | null {
  const match = /^(.+?):([1-9]\d*):(.*)$/.exec(value);
  if (match === null) return null;
  return {
    path: match[1].replace(/^\.\//, ""),
    line: Number.parseInt(match[2], 10),
    excerpt: match[3].slice(0, MAX_SEARCH_EXCERPT_CHARACTERS),
  };
}

async function run(
  sandbox: SandboxSession,
  command: string,
  abortSignal: AbortSignal,
): Promise<SandboxCommandResult> {
  return await sandbox.run({ command, abortSignal });
}

function successfulInspection(
  result: SandboxCommandResult,
  message: string,
): RepositoryResult<void> {
  if (result.exitCode !== 0 || result.stderr.trim() !== "") {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `${message}: ${summarizeCommandFailure(result)}`,
    ));
  }
  return ok(undefined);
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
