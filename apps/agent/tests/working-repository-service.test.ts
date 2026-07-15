import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { SandboxCommandResult } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import { test } from "vitest";
import { z } from "zod";

import type { ResolvedWorkingDocumentationRepository } from "../agent/lib/repository-contract";
import type { RepositoryActionRecord } from "../agent/lib/repository-materialization";
import {
  assertSafeGlobPattern,
  assertSafeRepositoryRelativePath,
  WorkingRepositoryService,
} from "../agent/lib/working-repository-service";
import {
  workingRepositoryModelOutput,
  workingRepositoryValidatorIdsInputSchema,
} from "../agent/tools/working_repository";

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
const sandboxRoot = "/workspace/working-docs";

test("working repository service", async () => {
  assert.deepEqual(
    workingRepositoryValidatorIdsInputSchema.parse([" internal.diff-quiet "]),
    ["internal.diff-quiet"],
  );
  assert.throws(
    () => workingRepositoryValidatorIdsInputSchema.parse("internal.diff-quiet"),
    /expected array/i,
  );
  assert.throws(
    () => workingRepositoryValidatorIdsInputSchema.parse('["internal.diff-quiet"]'),
    /expected array/i,
  );
  assert.throws(
    () =>
      workingRepositoryValidatorIdsInputSchema.parse(
        JSON.stringify(["one", "two", "three", "four", "five", "six"]),
      ),
    /Too big|at most 5/i,
  );
  assert.throws(
    () => workingRepositoryValidatorIdsInputSchema.parse(["x".repeat(161)]),
    /Too big|at most 160/i,
  );

  const validatorIdsJsonSchema = z.toJSONSchema(
    workingRepositoryValidatorIdsInputSchema,
    { io: "input" },
  ) as Record<string, unknown>;
  assert.equal(validatorIdsJsonSchema.type, "array");
  assert.equal(validatorIdsJsonSchema.minItems, 1);
  assert.equal(validatorIdsJsonSchema.maxItems, 5);
  assert.equal(
    (validatorIdsJsonSchema.items as Record<string, unknown> | undefined)?.maxLength,
    160,
  );

  const root = await mkdtemp(join(tmpdir(), "paige-working-repository-"));
  const repositoryRoot = join(root, "repository");
  const outside = join(root, "outside.md");
  await execFile("mkdir", ["-p", join(repositoryRoot, "docs", "guides")]);
  await writeFile(
    join(repositoryRoot, "docs", "guides", "example.md"),
    ["# Example", "", "Bounded repository search finds this line.", "Last line."].join("\n"),
  );
  await writeFile(join(repositoryRoot, "docs", "guides", "second.md"), "Search finds a second line.\n");
  const binaryAsset = Buffer.from([0, 255, 1, 254]);
  await writeFile(join(repositoryRoot, "docs", "guides", "asset.bin"), binaryAsset);
  await writeFile(outside, "outside the repository\n");
  await symlink(outside, join(repositoryRoot, "docs", "escape.md"));
  const packageSource = JSON.stringify({
    scripts: {
      build: "node -e \"console.log('build passed')\"",
      "test:fail": "node -e \"process.stdout.write('x'.repeat(5000)); process.exit(2)\"",
      start: "node server.js",
    },
  }, null, 2);
  await writeFile(join(repositoryRoot, "package.json"), packageSource);
  await writeFile(join(repositoryRoot, "README.md"), "Run `pnpm build` before review.\n");
  await execFile("git", ["init", "-q"], { cwd: repositoryRoot });
  await execFile("git", ["config", "user.email", "paige@example.com"], { cwd: repositoryRoot });
  await execFile("git", ["config", "user.name", "Paige"], { cwd: repositoryRoot });
  await execFile("git", ["add", "."], { cwd: repositoryRoot });
  await execFile("git", ["commit", "-qm", "fixture"], { cwd: repositoryRoot });

  const sandbox = new LocalSandbox(repositoryRoot);
  const ctx = {
    abortSignal: new AbortController().signal,
    getSandbox: async () => sandbox,
  } as unknown as ToolContext;
  const repository = workingRepository();
  const materialization = {
    repositoryUrl: repository.source.url,
    requestedRef: repository.ref,
    resolvedCommit: "fixture-revision",
    docsRoot: repository.docsRoot,
    sandboxPath: repository.sandboxPath,
    status: "materialized" as const,
  };
  const provenance: RepositoryActionRecord[] = [];
  let disclosedProfile;
  const service = new WorkingRepositoryService({
    ctx,
    repository,
    materialization,
    actionProvenance: provenance,
    onValidationProfile(profile) {
      disclosedProfile = profile;
    },
  });

  try {
    assert.equal(service.reference.resolvedRevision, "fixture-revision");
    const listed = await service.list({ pathPrefix: "docs", pattern: "**/*.md", limit: 1 });
    assert.equal(listed.entries.length, 1);
    assert.equal(listed.truncated, true);
    assert.equal(listed.omittedSymlinks, 1);
    const completeListing = await service.list({ pathPrefix: ".", pattern: "**/*.md", limit: 20 });
    assert.equal(completeListing.entries.some(({ path }) => path === "docs/escape.md"), false);
    assert.equal(completeListing.omittedSymlinks, 1);

    const read = await service.read({
      path: "docs/guides/example.md",
      startLine: 2,
      endLine: 3,
      maxCharacters: 20,
    });
    assert.equal(read.startLine, 2);
    assert.equal(read.endLine, 3);
    assert.equal(read.truncated, true);
    assert.match(read.content!, /truncated/);
    assert.equal(
      read.contentHash,
      createHash("sha256").update(["# Example", "", "Bounded repository search finds this line.", "Last line."].join("\n")).digest("hex"),
      "read returns the full-file precondition hash even for a truncated line range",
    );
    assert.equal(read.sizeBytes, Buffer.byteLength(["# Example", "", "Bounded repository search finds this line.", "Last line."].join("\n")));
    assert.equal(read.binary, false);

    const binaryRead = await service.read({ path: "docs/guides/asset.bin" });
    assert.equal(binaryRead.content, null);
    assert.equal(binaryRead.binary, true);
    assert.equal(binaryRead.truncated, false);
    assert.equal(binaryRead.contentHash, createHash("sha256").update(binaryAsset).digest("hex"));
    assert.equal(binaryRead.sizeBytes, binaryAsset.byteLength);

    const literal = await service.search({ query: "Search finds", kind: "literal", limit: 1 });
    assert.equal(literal.matches.length, 1);
    assert.equal(literal.truncated, true);
    const regex = await service.search({ query: "bounded\\s+repository", kind: "regex" });
    assert.equal(regex.matches[0]?.path, "docs/guides/example.md");

    const crowded = join(repositoryRoot, "docs", "a-crowded", "deep");
    const sibling = join(repositoryRoot, "docs", "z-sibling");
    await mkdir(crowded, { recursive: true });
    await mkdir(sibling, { recursive: true });
    for (let index = 0; index < 500; index += 1) {
      await writeFile(join(crowded, `${String(index).padStart(3, "0")}.md`), "crowded\n");
    }
    await writeFile(join(sibling, "target.md"), "breadth first discovery\n");
    const breadthFirst = await service.search({ query: "breadth first discovery" });
    assert.equal(breadthFirst.matches[0]?.path, "docs/z-sibling/target.md");
    await rm(join(repositoryRoot, "docs", "a-crowded"), { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });

    await assert.rejects(service.read({ path: "/etc/passwd" }), /relative path/i);
    await assert.rejects(service.read({ path: "../outside.md" }), /escape|relative path/i);
    await assert.rejects(service.read({ path: "docs\\example.md" }), /relative path/i);
    await assert.rejects(service.read({ path: "docs//example.md" }), /relative path|ambiguously/i);
    await assert.rejects(service.read({ path: "docs/escape.md" }), /symbolic links/i);
    await assert.rejects(
      service.search({ query: "(", kind: "regex" }),
      /invalid regular expression/i,
    );
    assert.throws(() => assertSafeRepositoryRelativePath("docs\nsecret.md"), /relative path/i);
    assert.throws(() => assertSafeGlobPattern("**/[abc].md"), /bounded/i);
    assert.throws(() => assertSafeGlobPattern("../**"), /traverse/i);

    const deniedActions: RepositoryActionRecord[] = [];
    const denied = new WorkingRepositoryService({
      ctx,
      repository: { ...repository, allowedActions: ["clone", "read"] },
      materialization,
      actionProvenance: deniedActions,
    });
    await assert.rejects(denied.search({ query: "Example" }), /not allowed: search/i);
    assert.equal(deniedActions.at(-1)?.status, "failure");

    const profile = await service.validators();
    assert.equal(disclosedProfile, profile);
    const build = profile.validators.find(({ id }) => id === "package:root:build");
    assert.equal(build?.owner, "repository");
    assert.deepEqual(build?.sources, ["package.json", "README.md"]);
    assert.equal(profile.validators.some(({ id }) => id.includes("start")), false);
    const modelProfile = workingRepositoryModelOutput({
      mode: "validators",
      executed: false,
      requiredNextMode: "run_validators",
      profile,
      repository: service.reference,
      actions: [],
    });
    assert.equal(JSON.stringify(modelProfile).includes("pnpm --dir"), false);
    const modelValue = modelProfile.value as {
      validators: Array<Record<string, unknown>>;
      followUps: Array<{ id: string; input: Record<string, unknown> }>;
    };
    assert.equal(modelValue.validators.every((validator) => !("command" in validator)), true);
    assert.deepEqual(
      modelValue.followUps.find(({ id }) => id === "internal.diff-quiet"),
      {
        id: "internal.diff-quiet",
        input: { mode: "run_validators", validatorIds: ["internal.diff-quiet"] },
      },
    );
    assert.equal(modelValue.followUps.every((followUp) => !("command" in followUp.input)), true);
    assert.equal(JSON.stringify(modelProfile).includes("git diff --quiet"), false);
    assert.match(JSON.stringify(modelProfile), /No validators ran.*run_validators/);
    assert.match(JSON.stringify(modelProfile), /read-only inspection.*does not mutate/);

    const buildResult = await service.runValidators(["package:root:build", "missing-validator"]);
    assert.equal(buildResult.results[0]?.status, "passed");
    assert.match(buildResult.results[0]?.stdout ?? "", /build passed/);
    assert.equal(buildResult.results[1]?.status, "unknown");
    const failed = await service.runValidators(["package:root:test:fail"]);
    assert.equal(failed.results[0]?.status, "failed");
    assert.equal(failed.results[0]?.exitCode, 2);
    assert.equal(failed.results[0]?.truncated, true);
    assert.ok((failed.results[0]?.stdout.length ?? 0) <= 4_000);

    await writeFile(join(repositoryRoot, "package.json"), packageSource.replace("build passed", "changed"));
    const staleService = new WorkingRepositoryService({
      ctx,
      repository,
      materialization,
      actionProvenance: provenance,
      validationProfile: profile,
    });
    const stale = await staleService.runValidators(["package:root:build"]);
    assert.equal(stale.results[0]?.status, "stale");

    const undisclosed = new WorkingRepositoryService({
      ctx,
      repository,
      materialization,
      actionProvenance: provenance,
    });
    const atomic = await undisclosed.runValidators(["internal.diff-check"]);
    assert.equal(
      atomic.profile.validators.some(({ id }) => id === "internal.diff-check"),
      true,
    );
    assert.equal(atomic.results[0]?.status, "passed");
    const atomicModel = workingRepositoryModelOutput({
      mode: "run_validators",
      executed: true,
      profile: atomic.profile,
      results: atomic.results,
      repository: service.reference,
      actions: [],
    });
    const atomicModelText = JSON.stringify(atomicModel);
    assert.match(atomicModelText, /internal\.diff-check/);
    assert.match(atomicModelText, /"status":"passed"/);
    assert.equal(atomicModelText.includes("git diff --check"), false);
    assert.equal(atomicModelText.includes("pnpm --dir"), false);

    await writeFile(join(repositoryRoot, "docs", "guides", "example.md"), "# Changed\n");
    const status = await service.status();
    assert.equal(status.clean, false);
    assert.ok(status.changedFiles.includes("docs/guides/example.md"));
    const diff = await service.diff(80);
    assert.equal(diff.noDiff, false);
    assert.equal(diff.truncated, true);

    assert.equal(
      provenance.some(({ action, provenanceLabel }) =>
        action === "read" && provenanceLabel === "working-documentation-repository"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function workingRepository(): ResolvedWorkingDocumentationRepository {
  return {
    source: { type: "github-url", url: "https://github.com/example/docs.git" },
    ref: "main",
    docsRoot: "docs",
    sandboxPath: sandboxRoot,
    accessMode: "sandbox-write",
    allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
    provenanceLabel: "working-documentation-repository",
  };
}

class LocalSandbox {
  readonly id = "working-repository-test";

  constructor(private readonly repositoryRoot: string) {}

  async run(input: { command: string; workingDirectory?: string }): Promise<SandboxCommandResult> {
    const command = this.map(input.command);
    const cwd = input.workingDirectory === undefined
      ? undefined
      : this.map(input.workingDirectory);
    try {
      const result = await exec(command, { cwd, maxBuffer: 2_000_000 });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr } as SandboxCommandResult;
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
      } as SandboxCommandResult;
    }
  }

  async readTextFile(input: {
    path: string;
    startLine?: number;
    endLine?: number;
  }): Promise<string | null> {
    try {
      const content = await readFile(this.map(input.path), "utf8");
      if (input.startLine === undefined && input.endLine === undefined) return content;
      const lines = content.split("\n");
      const start = (input.startLine ?? 1) - 1;
      const end = input.endLine ?? lines.length;
      return lines.slice(start, end).join("\n");
    } catch {
      return null;
    }
  }

  async readBinaryFile(input: { path: string }): Promise<Uint8Array | null> {
    try { return await readFile(this.map(input.path)); }
    catch { return null; }
  }

  private map(value: string): string {
    return value.replaceAll(sandboxRoot, this.repositoryRoot);
  }
}
