import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  catalogEvidenceRepositories,
  evidenceRepositories,
  resolveConfiguredEvidenceRepository,
} from "../repositories/evidence/config";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
  selectFileLines,
} from "../repositories/evidence/inspection";
import { documentationRepository } from "../repositories/documentation/config";
import { documentationRepositoryTodos } from "../repositories/documentation/service";
import type { DocumentationRepositoryService } from "../repositories/documentation/service";
import { repositoryMetadataTodos } from "../repositories/metadata/service";
import type { RepositoryMetadataService } from "../repositories/metadata/service";
import { RepositoryError } from "../repositories/shared/errors";
import { evidenceRepositoryToolInputSchema } from "../agent/tools/evidence_repository";

const documentationServiceMethods = [
  "prepareWorkspace",
  "inspectDiff",
  "createCommit",
  "openDraftPullRequest",
] satisfies Array<keyof DocumentationRepositoryService>;
const metadataServiceMethods = [
  "listReleases",
  "listOpenIssues",
  "listOpenPullRequests",
  "listTags",
  "listCommits",
  "compareRevisions",
] satisfies Array<keyof RepositoryMetadataService>;

describe("repository configuration", () => {
  test("keeps documentation and evidence repository contracts separate", () => {
    assert.equal(documentationRepository.type, "documentation");
    assert.deepEqual(
      evidenceRepositories.map((repository) => repository.type),
      ["evidence", "evidence", "evidence"],
    );
    assert.deepEqual(
      evidenceRepositories.map((repository) => repository.access),
      ["public", "public", "public"],
    );
    assert.deepEqual(
      catalogEvidenceRepositories().map((repository) => repository.id),
      ["saleor-core", "saleor-dashboard", "saleor-apps"],
    );
  });

  test("resolves only configured evidence repository ids", () => {
    const configured = resolveConfiguredEvidenceRepository(
      evidenceRepositories,
      "saleor-core",
    );
    assert(configured.isOk());
    assert.equal(configured.value.name, "saleor");

    const documentation = resolveConfiguredEvidenceRepository(
      evidenceRepositories,
      "saleor-docs",
    );
    assert(documentation.isErr());
    assert.equal(documentation.error.code, "REPOSITORY_NOT_CONFIGURED");

    const unconfigured = resolveConfiguredEvidenceRepository(
      evidenceRepositories,
      "unconfigured",
    );
    assert(unconfigured.isErr());
    assert.equal(unconfigured.error.code, "REPOSITORY_NOT_CONFIGURED");
    assert.match(
      unconfigured.error.message,
      /Evidence repository is not configured/,
    );
  });

  test("preserves coded error causes", () => {
    const cause = new Error("connector unavailable");
    const error = new RepositoryError(
      "REPOSITORY_GITHUB_AUTH_FAILED",
      "GitHub authentication failed.",
      { cause },
    );

    assert(error instanceof Error);
    assert.equal(error.name, "RepositoryError");
    assert.equal(error.code, "REPOSITORY_GITHUB_AUTH_FAILED");
    assert.equal(error.cause, cause);
  });
});

describe("evidence repository tool contract", () => {
  test("accepts the four read-only actions", () => {
    assert.deepEqual(
      evidenceRepositoryToolInputSchema.parse({ action: "catalog" }),
      { action: "catalog" },
    );
    assert.deepEqual(
      evidenceRepositoryToolInputSchema.parse({
        action: "search",
        repositoryId: "saleor-core",
        query: "checkout",
      }),
      {
        action: "search",
        repositoryId: "saleor-core",
        query: "checkout",
        pathPrefix: ".",
        limit: 50,
      },
    );
  });

  test("does not accept model-supplied repository coordinates", () => {
    assert.throws(() => evidenceRepositoryToolInputSchema.parse({
      action: "catalog",
      owner: "someone",
      name: "unconfigured",
    }));
  });

  test("rejects paths that escape a repository", () => {
    const docs = assertRepositoryRelativePath("./docs", { allowRoot: true });
    assert(docs.isOk());
    assert.equal(docs.value, "docs");

    const root = assertRepositoryRelativePath("/", { allowRoot: true });
    assert(root.isOk());
    assert.equal(root.value, ".");

    const escaping = assertRepositoryRelativePath("../private", {
      allowRoot: true,
    });
    assert(escaping.isErr());
    assert.equal(escaping.error.code, "REPOSITORY_INVALID_INPUT");

    const disallowedRoot = assertRepositoryRelativePath(".", {
      allowRoot: false,
    });
    assert(disallowedRoot.isErr());
    assert.match(disallowedRoot.error.message, /repository-relative path/);
  });

  test("bounds line reads and reports partial content", () => {
    const selection = selectFileLines("one\ntwo\nthree", {
      startLine: 2,
      endLine: 3,
      maxCharacters: 5,
    });
    assert(selection.isOk());
    assert.deepEqual(selection.value, {
      startLine: 2,
      endLine: 3,
      content: "two\nt",
      truncated: true,
    });
  });

  test("rejects invalid line ranges and oversized selections", () => {
    const reversed = selectFileLines("one\ntwo", {
      startLine: 2,
      endLine: 1,
    });
    assert(reversed.isErr());
    assert.equal(reversed.error.code, "REPOSITORY_INVALID_INPUT");

    const oversized = selectFileLines("content", {
      startLine: 1,
      endLine: 401,
    });
    assert(oversized.isErr());
    assert.match(oversized.error.message, /at most 400 lines/);
  });

  test("accepts literal search text but rejects multiline queries", () => {
    const literal = assertSearchQuery("  checkout -- '$HOME'  ");
    assert(literal.isOk());
    assert.equal(literal.value, "checkout -- '$HOME'");

    const multiline = assertSearchQuery("checkout\nsecret");
    assert(multiline.isErr());
    assert.equal(multiline.error.code, "REPOSITORY_INVALID_INPUT");
  });
});

describe("future repository capability shells", () => {
  test("records the documentation writeback phases without exposing a tool", () => {
    assert.deepEqual(documentationServiceMethods, [
      "prepareWorkspace",
      "inspectDiff",
      "createCommit",
      "openDraftPullRequest",
    ]);
    assert.deepEqual(documentationRepositoryTodos, [
      "materialize-real-git-checkout",
      "edit-only-configured-documentation-repository",
      "generate-bounded-diff",
      "require-explicit-writeback-approval",
      "create-branch-and-commit-from-base-revision",
      "push-and-open-draft-pull-request",
    ]);
  });

  test("records the bounded GitHub metadata reads to implement", () => {
    assert.deepEqual(metadataServiceMethods, [
      "listReleases",
      "listOpenIssues",
      "listOpenPullRequests",
      "listTags",
      "listCommits",
      "compareRevisions",
    ]);
    assert.deepEqual(repositoryMetadataTodos, [
      "list-releases",
      "list-open-issues",
      "list-open-pull-requests",
      "list-tags",
      "list-commits",
      "compare-revisions-and-list-changed-files",
    ]);
  });
});
