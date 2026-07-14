import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildWorkspaceKnowledgeSourceRegistry,
  normalizeWorkspaceKnowledgeLink,
  projectWorkspaceKnowledgeSource,
  workspaceKnowledgeSourceSchema,
} from "../src/workspace-knowledge-contract.ts";
import { repositoryInputSchema } from "../src/repository-contract.ts";

test("workspace knowledge source registry", () => {
  const repositoryInput = repositoryInputSchema.parse({
    workingDocumentationRepository: {
      source: { type: "github-url", url: "https://github.com/example/docs" },
      ref: "main",
      docsRoot: "docs",
    },
    watchedRepositories: [{
      id: "example-product",
      name: "Product source",
      description: "Product implementation evidence",
      source: { type: "github-url", url: "https://github.com/example/product" },
      defaultRef: "stable",
      sandboxPath: "/workspace/watched/example-product",
      pathFilters: ["src/**"],
      provenanceLabel: "watched-repository:example/product",
    }],
    contextRepositories: [{
      id: "example-decisions",
      name: "Accepted decisions",
      description: "Maintainer-approved product decisions",
      source: { type: "github-url", url: "https://github.com/example/decisions" },
      ref: "accepted",
      sandboxPath: "/workspace/context/example-decisions",
      pathFilters: ["decisions/**"],
      evidenceClass: "maintainer-confirmed-product-decision",
      canSupportPublicDocsClaim: true,
      provenanceLabel: "context-repository:example/decisions",
    }],
  });
  const sources = buildWorkspaceKnowledgeSourceRegistry({
    workspaceId: "workspace-a",
    repositoryInput,
  });

  assert.deepEqual(sources.map(({ sourceId }) => sourceId), [
    "working-documentation",
    "watched:example-product",
    "context:example-decisions",
  ]);
  assert.deepEqual(sources.map(({ accessMode }) => accessMode), [
    "sandbox-write",
    "sandbox-read",
    "sandbox-read",
  ]);
  assert.deepEqual(sources.map(({ evidenceClass }) => evidenceClass), [
    "current-documentation",
    "source-code-or-merged-change",
    "maintainer-confirmed-product-decision",
  ]);
  assert.equal(sources.every(({ contentTrust }) => contentTrust === "untrusted-data"), true);
  assert.equal(sources.every(({ readiness }) => readiness.status === "configured"), true);
  assert.equal("workspaceId" in projectWorkspaceKnowledgeSource(sources[0]!), false);
  assert.equal(
    normalizeWorkspaceKnowledgeLink("https://github.com/example/docs.git#readme"),
    "https://github.com/example/docs",
  );

  assert.throws(
    () => repositoryInputSchema.parse({
      ...repositoryInput,
      contextRepositories: [{
        ...repositoryInput.contextRepositories[0],
        allowedActions: ["clone", "read", "search", "patch", "publish-pr"],
      }],
    }),
    /Invalid option|allowedActions/i,
  );
  assert.throws(
    () => buildWorkspaceKnowledgeSourceRegistry({
      workspaceId: "workspace-a",
      repositoryInput: {
        ...repositoryInput,
        watchedRepositories: [
          repositoryInput.watchedRepositories[0]!,
          repositoryInput.watchedRepositories[0]!,
        ],
      },
    }),
    /unique stable identities/i,
  );
});

test("source kinds retain explicit access and evidence policy", () => {
  const cases = [
    ["working-documentation", "sandbox-write", "current-documentation", true],
    ["watched-repository", "sandbox-read", "source-code-or-merged-change", true],
    ["context-repository", "sandbox-read", "maintainer-confirmed-product-decision", true],
    ["release-feed", "provider-read", "official-release", false],
    ["provider-context", "provider-read", "provider-conversation-context", false],
    ["web", "public-read", "external-web-result", false],
    ["workspace-memory", "memory-read", "workspace-memory", false],
  ] as const;

  for (const [kind, accessMode, evidenceClass, repository] of cases) {
    assert.doesNotThrow(() => workspaceKnowledgeSourceSchema.parse(sourceFixture({
      kind,
      accessMode,
      evidenceClass,
      repository,
    })));
  }

  assert.throws(
    () => workspaceKnowledgeSourceSchema.parse(sourceFixture({
      kind: "context-repository",
      accessMode: "sandbox-write",
      evidenceClass: "source-code-or-merged-change",
      repository: true,
    })),
    /not allowed for context-repository/i,
  );
  assert.throws(
    () => workspaceKnowledgeSourceSchema.parse({
      ...sourceFixture({
        kind: "provider-context",
        accessMode: "provider-read",
        evidenceClass: "provider-conversation-context",
        repository: false,
      }),
      canSupportPublicDocsClaim: true,
    }),
    /cannot independently support/i,
  );
});

function sourceFixture(input: {
  kind: "working-documentation" | "watched-repository" | "context-repository" |
    "release-feed" | "provider-context" | "web" | "workspace-memory";
  accessMode: "sandbox-write" | "sandbox-read" | "provider-read" | "public-read" | "memory-read";
  evidenceClass: "current-documentation" | "source-code-or-merged-change" | "official-release" |
    "maintainer-confirmed-product-decision" | "provider-conversation-context" |
    "workspace-memory" | "external-web-result";
  repository: boolean;
}) {
  return {
    sourceId: `source:${input.kind}`,
    workspaceId: "workspace-a",
    kind: input.kind,
    displayName: input.kind,
    description: "Configured workspace knowledge source.",
    accessMode: input.accessMode,
    allowedReadActions: ["list", "search", "read"],
    repository: input.repository
      ? {
          url: "https://github.com/example/repository",
          requestedRef: "main",
          sandboxPath: "/workspace/source",
          pathFilters: [],
        }
      : undefined,
    provenanceLabel: `source-${input.kind}`,
    evidenceClass: input.evidenceClass,
    canSupportPublicDocsClaim: ![
      "provider-conversation-context",
      "workspace-memory",
      "external-web-result",
    ].includes(input.evidenceClass),
    freshness: { requestedRef: input.repository ? "main" : undefined, resolvedRevision: null, observedAt: null },
    readiness: { status: "configured", detail: "Access not checked.", access: "not-checked" },
    retention: { mode: "turn-only", detail: "Bounded turn evidence." },
    modelOutput: { maxSearchMatches: 50, maxExcerptCharacters: 500, maxReadCharacters: 24_000 },
    contentTrust: "untrusted-data",
  };
}
