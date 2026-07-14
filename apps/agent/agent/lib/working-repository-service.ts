import { createHash } from "node:crypto";

import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  joinSandboxPath,
  quoteShellArgument as sh,
  recordRepositoryAction,
  RepositoryPolicyError,
  summarizeCommandFailure,
  type RepositoryActionRecord,
} from "./repository-materialization";
import type { DocsMaintenanceWorkflowResult } from "./repository-workflow-contract";
import { assertSafeRepositoryPath } from "./repository-path-policy";

const MAX_LIST_ENTRIES = 200;
const MAX_LIST_DEPTH = 8;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_FILES = 500;
const MAX_SEARCH_ENTRIES = 5_000;
const MAX_READ_LINES = 400;
const MAX_READ_CHARACTERS = 24_000;
const MAX_DIFF_CHARACTERS = 50_000;
const MAX_VALIDATOR_OUTPUT_CHARACTERS = 4_000;
const MAX_INSPECTION_MILLISECONDS = 30_000;
const MAX_REPOSITORY_VALIDATOR_MILLISECONDS = 10 * 60_000;

export const workingRepositoryReferenceSchema = z.object({
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  resolvedRevision: z.string(),
  docsRoot: z.string(),
  sandboxPath: z.string(),
  provenanceLabel: z.string(),
});

export const workingRepositoryListEntrySchema = z.object({
  path: z.string(),
  type: z.enum(["file", "directory"]),
});

export const workingRepositorySearchMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  excerpt: z.string(),
});

export const workingRepositoryValidatorSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  owner: z.enum(["operator", "repository"]),
  sources: z.array(z.string()),
  sourceHash: z.string().optional(),
  executable: z.boolean(),
});

export const workingRepositoryValidationProfileSchema = z.object({
  repository: workingRepositoryReferenceSchema,
  validators: z.array(workingRepositoryValidatorSchema),
});

export const workingRepositoryValidatorResultSchema = z.object({
  id: z.string(),
  command: z.string().nullable(),
  status: z.enum(["passed", "failed", "unknown", "denied", "stale"]),
  exitCode: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  provenance: workingRepositoryReferenceSchema,
  sources: z.array(z.string()),
});

export type WorkingRepositoryReference = z.infer<typeof workingRepositoryReferenceSchema>;
export type WorkingRepositoryValidationProfile = z.infer<
  typeof workingRepositoryValidationProfileSchema
>;
export type WorkingRepositoryValidator = z.infer<typeof workingRepositoryValidatorSchema>;
export type WorkingRepositoryValidatorResult = z.infer<
  typeof workingRepositoryValidatorResultSchema
>;

type RepositoryMaterialization = DocsMaintenanceWorkflowResult["materialization"];

export type RepositoryInspectionTarget = {
  source: { url: string };
  ref: string;
  docsRoot: string;
  sandboxPath: string;
  allowedActions: readonly string[];
  provenanceLabel: string;
};

export class WorkingRepositoryService {
  readonly reference: WorkingRepositoryReference;
  private readonly ctx: ToolContext;
  private readonly repository: RepositoryInspectionTarget;
  private readonly actionProvenance: RepositoryActionRecord[];
  private validationProfile: WorkingRepositoryValidationProfile | undefined;
  private readonly onValidationProfile?: (profile: WorkingRepositoryValidationProfile) => void;

  constructor(input: {
    ctx: ToolContext;
    repository: RepositoryInspectionTarget;
    materialization: RepositoryMaterialization;
    actionProvenance: RepositoryActionRecord[];
    validationProfile?: WorkingRepositoryValidationProfile;
    onValidationProfile?: (profile: WorkingRepositoryValidationProfile) => void;
  }) {
    this.ctx = input.ctx;
    this.repository = input.repository;
    this.actionProvenance = input.actionProvenance;
    this.onValidationProfile = input.onValidationProfile;
    this.reference = workingRepositoryReferenceSchema.parse({
      repositoryUrl: input.repository.source.url,
      requestedRef: input.repository.ref,
      resolvedRevision: input.materialization.resolvedCommit ?? input.repository.ref,
      docsRoot: input.repository.docsRoot,
      sandboxPath: input.repository.sandboxPath,
      provenanceLabel: input.repository.provenanceLabel,
    });
    if (
      input.validationProfile !== undefined &&
      sameRepositoryReference(input.validationProfile.repository, this.reference)
    ) {
      this.validationProfile = workingRepositoryValidationProfileSchema.parse(
        input.validationProfile,
      );
    }
  }

  async list(input: {
    pathPrefix?: string;
    pattern?: string;
    limit?: number;
    maxDepth?: number;
  } = {}): Promise<{
    entries: Array<z.infer<typeof workingRepositoryListEntrySchema>>;
    truncated: boolean;
    omittedSymlinks: number;
    examined: number;
  }> {
    const pathPrefix = assertSafeRepositoryRelativePath(input.pathPrefix ?? ".");
    const pattern = assertSafeGlobPattern(input.pattern ?? "**/*");
    const limit = boundedInteger(input.limit ?? 100, 1, MAX_LIST_ENTRIES, "list limit");
    const maxDepth = boundedInteger(input.maxDepth ?? 4, 0, MAX_LIST_DEPTH, "list depth");
    this.assertActionAllowed("read", "list", pathPrefix);

    try {
      const result = await this.runNodeScript(LIST_SCRIPT, [
        this.repository.sandboxPath,
        pathPrefix,
        pattern,
        String(limit),
        String(maxDepth),
      ]);
      if (result.exitCode !== 0) throw new Error(summarizeCommandFailure(result));
      const parsed = z
        .object({
          entries: z.array(workingRepositoryListEntrySchema).max(MAX_LIST_ENTRIES),
          truncated: z.boolean(),
          omittedSymlinks: z.number().int().nonnegative(),
          examined: z.number().int().nonnegative(),
        })
        .parse(JSON.parse(result.stdout));
      this.record("list", "success", { target: `${pathPrefix} (${pattern})` });
      return parsed;
    } catch (error) {
      this.fail("list", `${pathPrefix} (${pattern})`, error);
    }
  }

  async search(input: {
    query: string;
    kind?: "literal" | "regex";
    caseSensitive?: boolean;
    pathPrefix?: string;
    pattern?: string;
    limit?: number;
  }): Promise<{
    matches: Array<z.infer<typeof workingRepositorySearchMatchSchema>>;
    truncated: boolean;
    searchedFiles: number;
    skippedLargeFiles: number;
    omittedSymlinks: number;
  }> {
    const query = assertSafeSearchQuery(input.query);
    const kind = input.kind ?? "literal";
    if (kind === "regex") assertValidRegularExpression(query, input.caseSensitive ?? false);
    const pathPrefix = assertSafeRepositoryRelativePath(input.pathPrefix ?? ".");
    const pattern = assertSafeGlobPattern(input.pattern ?? "**/*");
    const limit = boundedInteger(input.limit ?? 50, 1, MAX_SEARCH_MATCHES, "search limit");
    this.assertActionAllowed("search", "search", query);

    try {
      const result = await this.runNodeScript(SEARCH_SCRIPT, [
        this.repository.sandboxPath,
        pathPrefix,
        pattern,
        query,
        kind,
        String(input.caseSensitive ?? false),
        String(limit),
        String(MAX_SEARCH_FILES),
        String(MAX_SEARCH_ENTRIES),
      ]);
      if (result.exitCode !== 0) throw new Error(summarizeCommandFailure(result));
      const parsed = z
        .object({
          matches: z.array(workingRepositorySearchMatchSchema).max(MAX_SEARCH_MATCHES),
          truncated: z.boolean(),
          searchedFiles: z.number().int().nonnegative(),
          skippedLargeFiles: z.number().int().nonnegative(),
          omittedSymlinks: z.number().int().nonnegative(),
        })
        .parse(JSON.parse(result.stdout));
      this.record("search", "success", { target: query });
      return parsed;
    } catch (error) {
      this.fail("search", query, error);
    }
  }

  async read(input: {
    path: string;
    startLine?: number;
    endLine?: number;
    maxCharacters?: number;
  }): Promise<{
    path: string;
    startLine: number;
    endLine: number;
    content: string | null;
    binary: boolean;
    truncated: boolean;
    contentHash: string;
    sizeBytes: number;
  }> {
    const path = assertSafeRepositoryRelativePath(input.path);
    if (path === ".") throw new RepositoryPolicyError("Read requires a file path.");
    const startLine = boundedInteger(input.startLine ?? 1, 1, 1_000_000, "start line");
    const requestedEndLine = boundedInteger(
      input.endLine ?? startLine + MAX_READ_LINES - 1,
      startLine,
      1_000_000,
      "end line",
    );
    const endLine = Math.min(requestedEndLine, startLine + MAX_READ_LINES - 1);
    const maxCharacters = boundedInteger(
      input.maxCharacters ?? MAX_READ_CHARACTERS,
      1,
      MAX_READ_CHARACTERS,
      "read character limit",
    );
    this.assertActionAllowed("read", "read", path);

    try {
      await this.assertSafeExistingPath(path, "file");
      const sandbox = await this.ctx.getSandbox();
      const binary = await sandbox.readBinaryFile({
        path: joinSandboxPath(this.repository.sandboxPath, path),
        abortSignal: this.commandAbortSignal(MAX_INSPECTION_MILLISECONDS),
      });
      if (binary === null) throw new Error(`File does not exist: ${path}`);
      const binaryFile = isBinaryContent(binary);
      const content = binaryFile
        ? null
        : await sandbox.readTextFile({
            path: joinSandboxPath(this.repository.sandboxPath, path),
            startLine,
            endLine,
            abortSignal: this.commandAbortSignal(MAX_INSPECTION_MILLISECONDS),
          });
      if (!binaryFile && content === null) throw new Error(`File does not exist: ${path}`);
      const bounded = content === null
        ? { content: null, truncated: false }
        : truncateText(content, maxCharacters);
      this.record("read", "success", { target: `${path}:${startLine}-${endLine}` });
      return {
        path,
        startLine,
        endLine,
        ...bounded,
        binary: binaryFile,
        contentHash: createHash("sha256").update(binary).digest("hex"),
        sizeBytes: binary.byteLength,
      };
    } catch (error) {
      this.fail("read", path, error);
    }
  }

  async status(maxCharacters = 12_000): Promise<{
    status: string;
    changedFiles: string[];
    clean: boolean;
    truncated: boolean;
  }> {
    maxCharacters = boundedInteger(maxCharacters, 1, 12_000, "status character limit");
    this.assertActionAllowed("export-diff", "status");
    try {
      const sandbox = await this.ctx.getSandbox();
      const result = await sandbox.run({
        command: "git status --short --untracked-files=normal --ignore-submodules=all",
        workingDirectory: this.repository.sandboxPath,
        abortSignal: this.commandAbortSignal(MAX_INSPECTION_MILLISECONDS),
      });
      if (result.exitCode !== 0) throw new Error(summarizeCommandFailure(result));
      const bounded = truncateText(result.stdout, maxCharacters);
      const changedFiles = result.stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, 500)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
      this.record("status", "success");
      return { status: bounded.content, changedFiles, clean: changedFiles.length === 0, truncated: bounded.truncated };
    } catch (error) {
      this.fail("status", undefined, error);
    }
  }

  async diff(maxCharacters = MAX_DIFF_CHARACTERS): Promise<{
    diff: string;
    changedFiles: string[];
    noDiff: boolean;
    truncated: boolean;
  }> {
    maxCharacters = boundedInteger(maxCharacters, 1, MAX_DIFF_CHARACTERS, "diff character limit");
    this.assertActionAllowed("export-diff", "diff");
    try {
      const sandbox = await this.ctx.getSandbox();
      const abortSignal = this.commandAbortSignal(MAX_INSPECTION_MILLISECONDS);
      const [diff, files] = await Promise.all([
        sandbox.run({
          command: "git diff --no-ext-diff --binary --full-index --find-renames --",
          workingDirectory: this.repository.sandboxPath,
          abortSignal,
        }),
        sandbox.run({
          command: "git diff --name-only --no-renames --",
          workingDirectory: this.repository.sandboxPath,
          abortSignal,
        }),
      ]);
      if (diff.exitCode !== 0) throw new Error(summarizeCommandFailure(diff));
      if (files.exitCode !== 0) throw new Error(summarizeCommandFailure(files));
      const changedFiles = files.stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 500);
      const bounded = truncateText(diff.stdout, maxCharacters);
      this.record("diff", "success");
      return {
        diff: bounded.content,
        changedFiles,
        noDiff: changedFiles.length === 0 && diff.stdout.trim().length === 0,
        truncated: bounded.truncated,
      };
    } catch (error) {
      this.fail("diff", undefined, error);
    }
  }

  async validators(): Promise<WorkingRepositoryValidationProfile> {
    const packageEntries = await this.list({ pattern: "**/package.json", limit: 20, maxDepth: 4 });
    const packagePaths = packageEntries.entries
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.path)
      .filter((path) => path === "package.json" || path === `${this.repository.docsRoot}/package.json`)
      .slice(0, 2);
    const validators: WorkingRepositoryValidator[] = [
      internalValidator("internal.diff-check", "Check the current draft for whitespace errors", "git diff --check"),
      internalValidator("internal.diff-quiet", "Check that the current draft is empty", "git diff --quiet"),
    ];
    const packageSources = new Map<string, { content: string; scripts: Record<string, string> }>();

    for (const path of packagePaths) {
      const read = await this.read({ path, maxCharacters: MAX_READ_CHARACTERS });
      try {
        if (read.content === null) throw new Error("Package manifest is binary.");
        const scripts = z.record(z.string(), z.string()).parse(
          (JSON.parse(read.content) as { scripts?: unknown }).scripts ?? {},
        );
        packageSources.set(path, { content: read.content, scripts });
      } catch {
        this.record("validator-discovery", "failure", {
          target: path,
          reason: "The package script source is invalid or exceeds the trusted profile bound.",
        });
      }
    }

    const documentation = await this.validatorDocumentationSources();
    for (const [path, source] of packageSources) {
      const directory = path === "package.json" ? "." : path.slice(0, -"/package.json".length);
      for (const [name, script] of Object.entries(source.scripts)) {
        if (!isCandidateValidatorScript(name) || validators.length >= 30) continue;
        const id = packageValidatorId(path, name);
        const command = `pnpm --dir ${sh(directory)} run ${sh(name)}`;
        const documentedBy = documentation
          .filter(({ content }) => content.includes(name) || content.includes(script))
          .map(({ path: sourcePath }) => sourcePath);
        validators.push({
          id,
          label: `Run package script ${name}`,
          command,
          owner: "repository",
          sources: [path, ...documentedBy],
          sourceHash: hashText(source.content),
          executable: this.repository.allowedActions.includes("run-checks"),
        });
      }
    }

    const profile = workingRepositoryValidationProfileSchema.parse({
      repository: this.reference,
      validators: validators.map((validator) => ({
        ...validator,
        executable: validator.executable && this.repository.allowedActions.includes("run-checks"),
      })),
    });
    this.record("validator-discovery", "success", {
      target: `${profile.validators.length} named validators`,
    });
    this.validationProfile = profile;
    this.onValidationProfile?.(profile);
    return profile;
  }

  async runValidators(ids: string[]): Promise<{
    profile: WorkingRepositoryValidationProfile;
    results: WorkingRepositoryValidatorResult[];
  }> {
    const requested = z.array(z.string().trim().min(1).max(160)).min(1).max(5).parse(ids);
    const profile = this.validationProfile ?? await this.validators();
    const byId = new Map(profile.validators.map((validator) => [validator.id, validator]));
    const results: WorkingRepositoryValidatorResult[] = [];

    for (const id of requested) {
      const validator = byId.get(id);
      if (validator === undefined) {
        const result = this.validatorResult({ id, status: "unknown", sources: [] });
        this.record("run-validator", "failure", { target: id, reason: "Unknown validator id." });
        results.push(result);
        continue;
      }
      if (!validator.executable) {
        const result = this.validatorResult({
          id,
          command: validator.command,
          status: "denied",
          sources: validator.sources,
        });
        this.record("run-validator", "failure", { target: id, reason: "Repository validation is not allowed." });
        results.push(result);
        continue;
      }
      if (validator.owner === "repository" && !(await this.validatorSourceIsCurrent(validator))) {
        const result = this.validatorResult({
          id,
          command: validator.command,
          status: "stale",
          sources: validator.sources,
        });
        this.record("run-validator", "failure", {
          target: id,
          reason: "Validator source changed after discovery; rediscover validators before running it.",
        });
        results.push(result);
        continue;
      }

      const sandbox = await this.ctx.getSandbox();
      let commandResult;
      try {
        commandResult = await sandbox.run({
          command: validator.command,
          workingDirectory: this.repository.sandboxPath,
          abortSignal: this.commandAbortSignal(
            validator.owner === "operator"
              ? MAX_INSPECTION_MILLISECONDS
              : MAX_REPOSITORY_VALIDATOR_MILLISECONDS,
          ),
        });
      } catch (error) {
        const message = truncateText(
          error instanceof Error ? error.message : String(error),
          MAX_VALIDATOR_OUTPUT_CHARACTERS,
        );
        this.record("run-validator", "failure", {
          target: id,
          commandCategory: id,
          reason: message.content,
        });
        results.push(this.validatorResult({
          id,
          command: validator.command,
          status: "failed",
          stderr: message.content,
          truncated: message.truncated,
          sources: validator.sources,
        }));
        continue;
      }
      const stdout = truncateText(commandResult.stdout, MAX_VALIDATOR_OUTPUT_CHARACTERS);
      const stderr = truncateText(commandResult.stderr, MAX_VALIDATOR_OUTPUT_CHARACTERS);
      const status = commandResult.exitCode === 0 ? "passed" as const : "failed" as const;
      this.record("run-validator", status === "passed" ? "success" : "failure", {
        target: id,
        commandCategory: id,
        reason: status === "failed" ? summarizeCommandFailure(commandResult) : undefined,
      });
      results.push(this.validatorResult({
        id,
        command: validator.command,
        status,
        exitCode: commandResult.exitCode,
        stdout: stdout.content,
        stderr: stderr.content,
        truncated: stdout.truncated || stderr.truncated,
        sources: validator.sources,
      }));
    }

    return { profile, results };
  }

  private async validatorDocumentationSources(): Promise<Array<{ path: string; content: string }>> {
    const listing = await this.list({ pattern: "**/*", limit: 100, maxDepth: 3 });
    const paths = listing.entries
      .filter(({ type, path }) =>
        type === "file" && /(^|\/)(AGENTS\.md|CONTRIBUTING\.md|README\.md)$/i.test(path),
      )
      .map(({ path }) => path)
      .slice(0, 8);
    const sources: Array<{ path: string; content: string }> = [];
    for (const path of paths) {
      const read = await this.read({ path, maxCharacters: 12_000 });
      if (read.content !== null) sources.push({ path, content: read.content });
    }
    return sources;
  }

  private async validatorSourceIsCurrent(validator: WorkingRepositoryValidator): Promise<boolean> {
    const source = validator.sources[0];
    if (source === undefined || validator.sourceHash === undefined) return false;
    try {
      const current = await this.read({ path: source, maxCharacters: MAX_READ_CHARACTERS });
      return current.content !== null && !current.truncated && hashText(current.content) === validator.sourceHash;
    } catch {
      return false;
    }
  }

  private validatorResult(input: {
    id: string;
    command?: string;
    status: WorkingRepositoryValidatorResult["status"];
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    truncated?: boolean;
    sources: string[];
  }): WorkingRepositoryValidatorResult {
    return workingRepositoryValidatorResultSchema.parse({
      id: input.id,
      command: input.command ?? null,
      status: input.status,
      exitCode: input.exitCode ?? null,
      stdout: input.stdout ?? "",
      stderr: input.stderr ?? "",
      truncated: input.truncated ?? false,
      provenance: this.reference,
      sources: input.sources,
    });
  }

  private assertActionAllowed(
    action: "read" | "search" | "export-diff" | "run-checks",
    operation: string,
    target?: string,
  ): void {
    if (this.repository.allowedActions.includes(action)) return;
    const error = new RepositoryPolicyError(`Repository action is not allowed: ${action}`);
    this.record(operation, "failure", { target, reason: error.message });
    throw error;
  }

  private async assertSafeExistingPath(path: string, expected: "file" | "directory"): Promise<void> {
    await assertSafeRepositoryPath(this.ctx, this.repository, path, expected);
  }

  private async runNodeScript(script: string, args: string[]) {
    const sandbox = await this.ctx.getSandbox();
    return sandbox.run({
      command: ["node", "-e", sh(script), "--", ...args.map(sh)].join(" "),
      abortSignal: this.commandAbortSignal(MAX_INSPECTION_MILLISECONDS),
    });
  }

  private commandAbortSignal(timeoutMilliseconds: number): AbortSignal {
    return AbortSignal.any([
      this.ctx.abortSignal,
      AbortSignal.timeout(timeoutMilliseconds),
    ]);
  }

  private record(
    action: string,
    status: RepositoryActionRecord["status"],
    details: Omit<RepositoryActionRecord, "action" | "status" | "provenanceLabel"> = {},
  ): void {
    this.actionProvenance.push(
      recordRepositoryAction(this.repository, action, status, details),
    );
  }

  private fail(action: string, target: string | undefined, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    this.record(action, "failure", { target, reason: message });
    throw error instanceof Error ? error : new Error(message);
  }
}

function isBinaryContent(content: Uint8Array): boolean {
  if (content.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    return false;
  } catch {
    return true;
  }
}

export function assertSafeRepositoryRelativePath(value: string): string {
  const path = value.trim();
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//") ||
    hasControlCharacter(path)
  ) {
    throw new RepositoryPolicyError(`Use a safe repository-relative path: ${value}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === ".." || (part === "." && path !== "."))) {
    throw new RepositoryPolicyError(`Path cannot escape or ambiguously address the working repository: ${value}`);
  }
  return path;
}

export function assertSafeGlobPattern(value: string): string {
  const pattern = value.trim();
  if (
    pattern === "" ||
    pattern.length > 256 ||
    pattern.startsWith("/") ||
    pattern.includes("\\") ||
    pattern.includes("//") ||
    hasControlCharacter(pattern) ||
    /[[\]{}()!]/u.test(pattern)
  ) {
    throw new RepositoryPolicyError(`Use a bounded *, **, and ? repository glob: ${value}`);
  }
  if (pattern.split("/").some((part) => part === ".." || part === ".")) {
    throw new RepositoryPolicyError(`Glob cannot traverse outside the working repository: ${value}`);
  }
  return pattern;
}

export function truncateText(value: string, maxCharacters: number): {
  content: string;
  truncated: boolean;
} {
  if (value.length <= maxCharacters) return { content: value, truncated: false };
  const suffix = "\n...[truncated]";
  return {
    content: `${value.slice(0, Math.max(0, maxCharacters - suffix.length))}${suffix}`,
    truncated: true,
  };
}

function assertSafeSearchQuery(value: string): string {
  if (value.trim() === "" || value.length > 500 || hasControlCharacter(value)) {
    throw new RepositoryPolicyError("Search queries must be non-empty, single-line, and at most 500 characters.");
  }
  return value;
}

function assertValidRegularExpression(value: string, caseSensitive: boolean): void {
  try {
    new RegExp(value, caseSensitive ? "u" : "iu");
  } catch (error) {
    throw new RepositoryPolicyError(
      `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RepositoryPolicyError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function internalValidator(id: string, label: string, command: string): WorkingRepositoryValidator {
  return {
    id,
    label,
    command,
    owner: "operator",
    sources: ["Paige internal repository policy"],
    executable: true,
  };
}

function isCandidateValidatorScript(name: string): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/u.test(name) &&
    /(^|[:_-])(build|check|lint|link|preview|test)([:_-]|$)/iu.test(name)
  );
}

function packageValidatorId(path: string, script: string): string {
  const scope = path === "package.json"
    ? "root"
    : path.slice(0, -"/package.json".length).replaceAll("/", ".");
  return `package:${scope}:${script}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameRepositoryReference(
  left: WorkingRepositoryReference,
  right: WorkingRepositoryReference,
): boolean {
  return (
    left.repositoryUrl === right.repositoryUrl &&
    left.requestedRef === right.requestedRef &&
    left.resolvedRevision === right.resolvedRevision &&
    left.docsRoot === right.docsRoot &&
    left.sandboxPath === right.sandboxPath &&
    left.provenanceLabel === right.provenanceLabel
  );
}

const LIST_SCRIPT = String.raw`
const operation = "list";
const fs = require("node:fs");
const path = require("node:path");
const [root, prefix, pattern, limitValue, depthValue] = process.argv.slice(1);
const limit = Number(limitValue);
const maxDepth = Number(depthValue);
const ignored = new Set([".git", ".docusaurus", ".next", "build", "coverage", "dist", "node_modules", "out"]);
function globRegex(glob) {
  let out = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") { index += 1; out += "(?:.*/)?"; } else out += ".*";
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}
try {
  const rootReal = fs.realpathSync(root);
  const start = path.resolve(rootReal, prefix === "." ? "" : prefix);
  if (start !== rootReal && !start.startsWith(rootReal + path.sep)) throw new Error("Path escapes the configured working repository.");
  if (fs.lstatSync(start).isSymbolicLink()) throw new Error("Symbolic link prefixes are not allowed.");
  if (!fs.statSync(start).isDirectory()) throw new Error("List prefix is not a directory.");
  const matcher = globRegex(pattern);
  const entries = [];
  let omittedSymlinks = 0;
  let examined = 0;
  let truncated = false;
  function walk(directory, depth) {
    if (truncated || depth > maxDepth) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      examined += 1;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootReal, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) { omittedSymlinks += 1; continue; }
      if (!entry.isDirectory() && !entry.isFile()) continue;
      if (matcher.test(relative)) entries.push({ path: relative, type: entry.isDirectory() ? "directory" : "file" });
      if (entries.length >= limit) { truncated = true; return; }
      if (entry.isDirectory()) walk(absolute, depth + 1);
      if (truncated) return;
    }
  }
  walk(start, 0);
  process.stdout.write(JSON.stringify({ entries, truncated, omittedSymlinks, examined }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;

const SEARCH_SCRIPT = String.raw`
const operation = "search";
const fs = require("node:fs");
const path = require("node:path");
const [root, prefix, pattern, query, kind, caseSensitiveValue, limitValue, maxFilesValue, maxEntriesValue] = process.argv.slice(1);
const limit = Number(limitValue);
const maxFiles = Number(maxFilesValue);
const maxEntries = Number(maxEntriesValue);
const caseSensitive = caseSensitiveValue === "true";
const ignored = new Set([".git", ".docusaurus", ".next", "build", "coverage", "dist", "node_modules", "out"]);
function globRegex(glob) {
  let out = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") { index += 1; out += "(?:.*/)?"; } else out += ".*";
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}
try {
  const rootReal = fs.realpathSync(root);
  const start = path.resolve(rootReal, prefix === "." ? "" : prefix);
  if (start !== rootReal && !start.startsWith(rootReal + path.sep)) throw new Error("Path escapes the configured working repository.");
  if (fs.lstatSync(start).isSymbolicLink()) throw new Error("Symbolic link prefixes are not allowed.");
  const pathMatcher = globRegex(pattern);
  const textMatcher = kind === "regex" ? new RegExp(query, caseSensitive ? "u" : "iu") : null;
  const expected = caseSensitive ? query : query.toLocaleLowerCase();
  const matches = [];
  let searchedFiles = 0;
  let skippedLargeFiles = 0;
  let omittedSymlinks = 0;
  let examinedEntries = 0;
  let truncated = false;
  const directories = [start];
  while (directories.length > 0 && !truncated) {
    const directory = directories.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      examinedEntries += 1;
      if (examinedEntries > maxEntries) { truncated = true; break; }
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootReal, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) { omittedSymlinks += 1; continue; }
      if (entry.isDirectory()) { directories.push(absolute); continue; }
      if (!entry.isFile() || !pathMatcher.test(relative)) continue;
      if (searchedFiles >= maxFiles) { truncated = true; break; }
      const stat = fs.statSync(absolute);
      if (stat.size > 524288) { skippedLargeFiles += 1; continue; }
      const content = fs.readFileSync(absolute, "utf8");
      if (content.includes("\0")) continue;
      searchedFiles += 1;
      for (const [index, line] of content.split(/\r?\n/u).entries()) {
        const matched = textMatcher === null
          ? (caseSensitive ? line : line.toLocaleLowerCase()).includes(expected)
          : textMatcher.test(line);
        if (!matched) continue;
        matches.push({ path: relative, line: index + 1, excerpt: line.slice(0, 500) });
        if (matches.length >= limit) { truncated = true; break; }
      }
      if (truncated) break;
    }
  }
  process.stdout.write(JSON.stringify({ matches, truncated, searchedFiles, skippedLargeFiles, omittedSymlinks }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
