import assert from "node:assert/strict";

import type { ToolContext } from "eve/tools";

import {
  createGitHubWritebackClient,
  type GitHubWritebackTransport,
} from "../agent/lib/github-writeback-client";
import {
  publishWorkingRepositoryPr,
  publishWorkingRepositoryPrOutputSchema,
  type GitHubWritebackCoordinatorDependencies,
} from "../agent/lib/github-writeback";
import type { DocsSignalDetail } from "../agent/lib/docs-signals";
import type { WorkflowState } from "../agent/lib/repository-workflow-contract";
import { test } from "vitest";

test("github writeback", async () => {
const abortSignal = new AbortController().signal;
const publishInput = {
  token: "github-app-token",
  slug: { owner: "example", repo: "docs" },
  baseBranch: "main",
  baseSha: "base-sha",
  branchName: "docs-agent/main/publish-test",
  commitMessage: "docs: publish test",
  title: "Publish test",
  body: "Prepared documentation update.",
  changedFiles: [
    {
      path: "docs/guide.md",
      mode: "100644" as const,
      content: "# Guide\n",
    },
    {
      path: "static/diagram.png",
      mode: "100644" as const,
      contentBase64: "AAEC/w==",
    },
    {
      path: "docs/obsolete.md",
      mode: "100644" as const,
      deleted: true as const,
    },
  ],
  abortSignal,
};

{
  const github = fakeGitHub();
  const result = await createGitHubWritebackClient(github.transport)
    .publishDraftPullRequest(publishInput);

  assert.equal(result.treeSha, "publish-tree-sha");
  assert.equal(result.commitSha, "publish-commit-sha");
  assert.deepEqual(result.pullRequest, {
    number: 42,
    url: "https://github.com/example/docs/pull/42",
    draft: true,
  });

  const blobRequest = requestWithPath(github.requests, "POST", "/git/blobs");
  assert.deepEqual(blobRequest.body, {
    content: "AAEC/w==",
    encoding: "base64",
  });
  const treeRequest = requestWithPath(github.requests, "POST", "/git/trees");
  assert.deepEqual(treeRequest.body, {
    base_tree: "base-tree-sha",
    tree: [
      {
        path: "docs/guide.md",
        mode: "100644",
        type: "blob",
        content: "# Guide\n",
      },
      {
        path: "static/diagram.png",
        mode: "100644",
        type: "blob",
        sha: "binary-blob-sha",
      },
      {
        path: "docs/obsolete.md",
        mode: "100644",
        type: "blob",
        sha: null,
      },
    ],
  });
  const pullRequest = requestWithPath(github.requests, "POST", "/pulls");
  assert.deepEqual(pullRequest.body, {
    title: publishInput.title,
    body: publishInput.body,
    head: publishInput.branchName,
    base: publishInput.baseBranch,
    draft: true,
  });
}

{
  const github = fakeGitHub({ baseSha: "moved-base-sha" });
  await assert.rejects(
    () => createGitHubWritebackClient(github.transport)
      .publishDraftPullRequest(publishInput),
    /Base branch moved.*Expected base-sha, found moved-base-sha/,
  );
  assert.equal(github.requests.some(isWriteRequest), false);
}

{
  const github = fakeGitHub({
    branch: { sha: "existing-commit-sha", treeSha: "publish-tree-sha" },
  });
  const result = await createGitHubWritebackClient(github.transport)
    .publishDraftPullRequest(publishInput);

  assert.equal(result.commitSha, "existing-commit-sha");
  assert.equal(github.requests.some((request) =>
    request.method === "POST" && request.path.endsWith("/git/commits")
  ), false);
  assert.equal(github.requests.some((request) =>
    request.method === "POST" && request.path.endsWith("/git/refs")
  ), false);
  assert.equal(github.requests.filter((request) =>
    request.method === "POST" && request.path.endsWith("/pulls")
  ).length, 1);
}

{
  const github = fakeGitHub({
    branch: { sha: "conflicting-commit-sha", treeSha: "other-tree-sha" },
  });
  await assert.rejects(
    () => createGitHubWritebackClient(github.transport)
      .publishDraftPullRequest(publishInput),
    /Branch already exists.*different content/,
  );
  assert.equal(github.requests.some((request) =>
    request.method === "POST" && request.path.endsWith("/pulls")
  ), false);
}

{
  const github = fakeGitHub({
    branch: { sha: "existing-commit-sha", treeSha: "publish-tree-sha" },
    pullRequest: {
      number: 17,
      html_url: "https://github.com/example/docs/pull/17",
      draft: true,
    },
  });
  const result = await createGitHubWritebackClient(github.transport)
    .publishDraftPullRequest(publishInput);

  assert.equal(result.pullRequest.number, 17);
  assert.equal(github.requests.some((request) =>
    request.method === "POST" && request.path.endsWith("/pulls")
  ), false);
}

{
  const github = fakeGitHub({ malformedBaseCommit: true });
  await assert.rejects(
    () => createGitHubWritebackClient(github.transport)
      .publishDraftPullRequest(publishInput),
    /returned a malformed response.*tree/,
  );
}

{
  const github = fakeGitHub({ interruptAfterPullCreationOnce: true });
  const client = createGitHubWritebackClient(github.transport);
  await assert.rejects(
    () => client.publishDraftPullRequest(publishInput),
    /connection interrupted after GitHub accepted the pull request/,
  );
  const recovered = await client.publishDraftPullRequest(publishInput);

  assert.equal(recovered.pullRequest.number, 42);
  assert.equal(github.requests.filter((request) =>
    request.method === "POST" && request.path.endsWith("/git/commits")
  ).length, 1);
  assert.equal(github.requests.filter((request) =>
    request.method === "POST" && request.path.endsWith("/git/refs")
  ).length, 1);
  assert.equal(github.requests.filter((request) =>
    request.method === "POST" && request.path.endsWith("/pulls")
  ).length, 1);
}

{
  const state = workflowStateFixture();
  const signal = signalFixture("patch-prepared");
  const savedProvenance: WorkflowState["actionProvenance"][] = [];
  const transitionInputs: unknown[] = [];
  let publishAttempts = 0;
  const dependencies = {
    async requireSetupReady() {
      return {};
    },
    async preflightGitHubWritebackSetup() {
      return {
        githubWritebackReady: true,
        githubWriteback: { preflight: { message: "GitHub writeback is ready." } },
      };
    },
    async loadRepositoryWorkflowState() {
      return state;
    },
    async saveRepositoryWorkflowState(nextState: WorkflowState) {
      savedProvenance.push(structuredClone(nextState.actionProvenance));
    },
    async listChangedFiles() {
      return ["docs/guide.md"];
    },
    async exportRepositoryDiff() {
      return state.lastResult?.diff ?? "";
    },
    async collectChangedFileEntries() {
      return [{ path: "docs/guide.md", mode: "100644" as const, content: "# Guide\n" }];
    },
    async resolveGitHubToken() {
      return "github-app-token";
    },
    githubClient: {
      async publishDraftPullRequest() {
        publishAttempts += 1;
        if (publishAttempts === 1) {
          throw new Error("Remote branch exists, but the response was interrupted.");
        }
        return {
          treeSha: "publish-tree-sha",
          commitSha: "publish-commit-sha",
          pullRequest: {
            number: 42,
            url: "https://github.com/example/docs/pull/42",
            draft: true,
          },
        };
      },
    },
    async getDocsSignal() {
      return signal;
    },
    async transitionDocsSignalLifecycle(input: unknown) {
      transitionInputs.push(input);
      return signalFixture("draft-pr-opened");
    },
  } as unknown as GitHubWritebackCoordinatorDependencies;
  const ctx = {
    abortSignal,
    async getSandbox() {
      return {
        async run() {
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
    },
  } as unknown as ToolContext;
  const input = {
    baseBranch: "main",
    branchName: "docs-agent/main/publish-test",
    title: "Publish test",
    commitMessage: "docs: publish test",
    signalId: signal.id,
  };

  await assert.rejects(
    () => publishWorkingRepositoryPr(input, ctx, dependencies),
    /response was interrupted/,
  );
  assert.equal(transitionInputs.length, 0);
  assert.deepEqual(savedProvenance.at(-1)?.map(({ status }) => status), ["failure"]);

  const result = await publishWorkingRepositoryPr(input, ctx, dependencies);
  assert.equal(result.signal?.status, "draft-pr-opened");
  assert.equal(transitionInputs.length, 1);
  assert.deepEqual(state.actionProvenance.map(({ status }) => status), [
    "failure",
    "success",
  ]);
  assert.equal(
    state.actionProvenance.at(-1)?.target,
    "example/docs#42",
  );
  assert.deepEqual(savedProvenance.at(-1), state.actionProvenance);
  assert.equal(publishWorkingRepositoryPrOutputSchema.parse(result).published, true);
}

console.log("GitHub writeback client and coordinator checks passed.");

type RecordedRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

function fakeGitHub(options: {
  baseSha?: string;
  branch?: { sha: string; treeSha: string };
  pullRequest?: { number: number; html_url: string; draft: boolean };
  malformedBaseCommit?: boolean;
  interruptAfterPullCreationOnce?: boolean;
} = {}): {
  transport: GitHubWritebackTransport;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const baseSha = options.baseSha ?? "base-sha";
  let branch = options.branch;
  let pullRequest = options.pullRequest;
  let interruptAfterPullCreation = options.interruptAfterPullCreationOnce ?? false;

  const transport: GitHubWritebackTransport = async (input) => {
    requests.push({ method: input.method, path: input.path, body: input.body });

    if (input.method === "GET" && input.path.endsWith("/git/ref/heads/main")) {
      return success({
        ref: "refs/heads/main",
        object: { sha: baseSha, type: "commit" },
      });
    }

    if (input.method === "GET" && input.path.endsWith(`/git/commits/${baseSha}`)) {
      if (options.malformedBaseCommit) return success({ sha: baseSha });
      return success({ sha: baseSha, tree: { sha: "base-tree-sha" } });
    }

    if (input.method === "POST" && input.path.endsWith("/git/blobs")) {
      return success({ sha: "binary-blob-sha" }, 201);
    }

    if (input.method === "POST" && input.path.endsWith("/git/trees")) {
      return success({ sha: "publish-tree-sha" }, 201);
    }

    if (
      input.method === "GET" &&
      input.path.endsWith(`/git/ref/heads/${publishInput.branchName}`)
    ) {
      return branch === undefined
        ? notFound()
        : success({
            ref: `refs/heads/${publishInput.branchName}`,
            object: { sha: branch.sha, type: "commit" },
          });
    }

    if (
      input.method === "GET" &&
      branch !== undefined &&
      input.path.endsWith(`/git/commits/${branch.sha}`)
    ) {
      return success({ sha: branch.sha, tree: { sha: branch.treeSha } });
    }

    if (input.method === "GET" && input.path.includes("/pulls?")) {
      return success(pullRequest === undefined ? [] : [pullRequest]);
    }

    if (input.method === "POST" && input.path.endsWith("/git/commits")) {
      return success({
        sha: "publish-commit-sha",
        tree: { sha: "publish-tree-sha" },
      }, 201);
    }

    if (input.method === "POST" && input.path.endsWith("/git/refs")) {
      branch = { sha: "publish-commit-sha", treeSha: "publish-tree-sha" };
      return success({
        ref: `refs/heads/${publishInput.branchName}`,
        object: { sha: branch.sha, type: "commit" },
      }, 201);
    }

    if (input.method === "POST" && input.path.endsWith("/pulls")) {
      pullRequest = {
        number: 42,
        html_url: "https://github.com/example/docs/pull/42",
        draft: true,
      };
      if (interruptAfterPullCreation) {
        interruptAfterPullCreation = false;
        throw new Error(
          "The connection interrupted after GitHub accepted the pull request.",
        );
      }
      return success(pullRequest, 201);
    }

    throw new Error(`Unexpected fake GitHub request: ${input.method} ${input.path}`);
  };

  return { transport, requests };
}

function success(body: unknown, status = 200) {
  return { ok: true as const, status, body };
}

function notFound() {
  return { ok: false as const, status: 404, message: "Not Found" };
}

function requestWithPath(
  requests: RecordedRequest[],
  method: RecordedRequest["method"],
  suffix: string,
): RecordedRequest {
  const request = requests.find((item) =>
    item.method === method && item.path.endsWith(suffix)
  );
  assert.ok(request, `Expected ${method} request ending with ${suffix}.`);
  return request;
}

function isWriteRequest(request: RecordedRequest): boolean {
  return request.method === "POST";
}

function workflowStateFixture(): WorkflowState {
  const repositoryUrl = "https://github.com/example/docs.git";
  const sandboxPath = "/workspace/working-docs";
  const materialization = {
    repositoryUrl,
    requestedRef: "main",
    resolvedCommit: "base-sha",
    docsRoot: "docs",
    sandboxPath,
    status: "materialized" as const,
  };

  return {
    repositoryInput: {
      workingDocumentationRepository: {
        source: { type: "github-url", url: repositoryUrl },
        ref: "main",
        docsRoot: "docs",
        sandboxPath,
        accessMode: "sandbox-write",
        allowedActions: [
          "clone",
          "read",
          "search",
          "patch",
          "run-checks",
          "export-diff",
          "publish-pr",
        ],
        provenanceLabel: "working-documentation-repository",
      },
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [],
    },
    materialization,
    actionProvenance: [],
    lastResult: {
      ok: true,
      scenarioKind: "unknown",
      materialization,
      report: {
        decision: "docs-patch",
        affectedPages: ["docs/guide.md"],
        proposedAction: "Review the prepared patch.",
        evidence: ["The source behavior changed."],
        consideredPages: ["docs/guide.md"],
        uncertainty: [],
        patchSummary: "Update the guide.",
        checks: [{
          name: "diff-check",
          command: "git diff --check",
          exitCode: 0,
          status: "passed",
          stdout: "",
          stderr: "",
        }],
      },
      changedFiles: ["docs/guide.md"],
      diff: "diff --git a/docs/guide.md b/docs/guide.md\n",
      noDiff: false,
      actionProvenance: [],
      rawSandboxToolsPolicy: "Authored repository tools only.",
    },
  };
}

function signalFixture(status: DocsSignalDetail["status"]): DocsSignalDetail {
  const timestamp = "2026-07-13T10:00:00.000Z";
  return {
    id: "signal-writeback-test",
    workspaceId: "default",
    status,
    sourceKind: "manual-scenario",
    dedupeKey: null,
    sourceSummary: "The guide needs a checked update.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: ["docs/guide.md"],
    productSurfaces: [],
    missingEvidence: [],
    uncertainty: null,
    priority: 0,
    nextActionAt: null,
    capturedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    sources: [{
      id: "source-writeback-test",
      signalId: "signal-writeback-test",
      workspaceId: "default",
      kind: "manual-scenario",
      provider: null,
      providerId: null,
      permalink: null,
      title: null,
      authors: [],
      sourceText: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      capturedAt: timestamp,
      metadata: {},
      createdAt: timestamp,
    }],
    links: [],
    artifacts: [],
    events: [],
    ownedWork: null,
  };
}
});
