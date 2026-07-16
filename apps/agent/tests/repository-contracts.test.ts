import assert from "node:assert/strict";

import { describe, test } from "vitest";

import documentationPublishTool, {
  documentationPublishToolInputSchema,
} from "../agent/tools/documentation_publish";
import {
  documentationWorkspaceToolInputSchema,
} from "../agent/tools/documentation_workspace";
import {
  repositoryReadToolInputSchema,
} from "../agent/tools/repository_read";
import {
  assertDocumentationRepository,
  catalogRepositories,
  documentationRepository,
  repositories,
  resolveConfiguredRepository,
} from "../repositories/config";
import {
  assertRepositoryRelativePath,
  assertSearchQuery,
  selectFileLines,
} from "../repositories/files";
import { repositoryMetadataTodos } from "../repositories/metadata/service";
import type { RepositoryMetadataService } from "../repositories/metadata/service";
import { RepositoryError } from "../repositories/shared/errors";

const metadataServiceMethods = [
  "listReleases",
  "listOpenIssues",
  "listOpenPullRequests",
  "listTags",
  "listCommits",
] satisfies Array<keyof RepositoryMetadataService>;

describe("repository configuration", () => {
  test("keeps one catalog and distinguishes only repository authority", () => {
    assert.equal(documentationRepository.id, "saleor-docs");
    assert.deepEqual(
      catalogRepositories().map(({ id, role }) => ({ id, role })),
      [
        { id: "saleor-core", role: "evidence" },
        { id: "saleor-dashboard", role: "evidence" },
        { id: "saleor-apps", role: "evidence" },
        { id: "saleor-docs", role: "documentation" },
      ],
    );
    assert.equal("access" in repositories[0], false);
  });

  test("resolves only configured repository ids", () => {
    const configured = resolveConfiguredRepository(
      repositories,
      "saleor-core",
    );
    assert(configured.isOk());
    assert.equal(configured.value.name, "saleor");

    const documentation = resolveConfiguredRepository(
      repositories,
      "saleor-docs",
    );
    assert(documentation.isOk());
    assert.equal(documentation.value.role, "documentation");

    const unconfigured = resolveConfiguredRepository(
      repositories,
      "unconfigured",
    );
    assert(unconfigured.isErr());
    assert.equal(unconfigured.error.code, "REPOSITORY_NOT_CONFIGURED");
    assert.match(unconfigured.error.message, /Repository is not configured/);
  });

  test("allows writes only for the documentation role", () => {
    const evidence = assertDocumentationRepository(repositories[0]);
    assert(evidence.isErr());
    assert.equal(evidence.error.code, "REPOSITORY_WRITE_FORBIDDEN");

    const documentation = assertDocumentationRepository(
      documentationRepository,
    );
    assert(documentation.isOk());
    assert.equal(documentation.value.id, "saleor-docs");
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

describe("repository tool contract", () => {
  test("accepts catalog, ref reads, and comparisons", () => {
    assert.deepEqual(
      repositoryReadToolInputSchema.parse({ action: "catalog" }),
      { action: "catalog" },
    );
    assert.deepEqual(
      repositoryReadToolInputSchema.parse({
        action: "search",
        repositoryId: "saleor-core",
        ref: "3.21",
        query: "checkout",
      }),
      {
        action: "search",
        repositoryId: "saleor-core",
        ref: "3.21",
        query: "checkout",
        pathPrefix: ".",
        limit: 50,
      },
    );
    assert.deepEqual(
      repositoryReadToolInputSchema.parse({
        action: "compare",
        repositoryId: "saleor-core",
        baseRef: "3.20",
        headRef: "3.21",
      }),
      {
        action: "compare",
        repositoryId: "saleor-core",
        baseRef: "3.20",
        headRef: "3.21",
        pathPrefix: ".",
        limit: 100,
      },
    );
  });

  test("does not accept model-supplied repository coordinates", () => {
    assert.throws(() => repositoryReadToolInputSchema.parse({
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

describe("documentation tool contract", () => {
  test("separates local authoring from approval-gated publication", async () => {
    assert.deepEqual(
      documentationWorkspaceToolInputSchema.parse({ action: "prepare" }),
      { action: "prepare" },
    );
    assert.deepEqual(
      documentationWorkspaceToolInputSchema.parse({
        action: "write",
        path: "docs/example.md",
        content: "Example\n",
      }),
      {
        action: "write",
        path: "docs/example.md",
        content: "Example\n",
      },
    );
    assert.deepEqual(
      documentationWorkspaceToolInputSchema.parse({
        action: "inspect_diff",
      }),
      { action: "inspect_diff" },
    );
    const publish = documentationPublishToolInputSchema.parse({
      digest: `sha256:${"a".repeat(64)}`,
      branch: "paige/update-example",
      commitMessage: "docs: update example",
      pullRequestTitle: "Update example",
      pullRequestBody: "Prepared by Paige.",
    });
    assert.equal(publish.branch, "paige/update-example");
    assert.equal(
      await documentationPublishTool.approval?.({
        approvedTools: new Set(),
        callId: "call-1",
        session: undefined,
        toolInput: publish,
        toolName: "documentation_publish",
      } as never),
      "user-approval",
    );
  });

  test("rejects arbitrary branches and malformed approval digests", () => {
    assert.throws(() =>
      documentationPublishToolInputSchema.parse({
        digest: "not-a-digest",
        branch: "feature/update-example",
        commitMessage: "docs: update example",
        pullRequestTitle: "Update example",
        pullRequestBody: "",
      })
    );
  });
});

describe("future repository capabilities", () => {
  test("keeps repository metadata deferred and separate from Git comparisons", () => {
    assert.deepEqual(metadataServiceMethods, [
      "listReleases",
      "listOpenIssues",
      "listOpenPullRequests",
      "listTags",
      "listCommits",
    ]);
    assert.deepEqual(repositoryMetadataTodos, [
      "list-releases",
      "list-open-issues",
      "list-open-pull-requests",
      "list-tags",
      "list-commits",
    ]);
  });
});
