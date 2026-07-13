import assert from "node:assert/strict";

import type { SandboxCommandResult } from "eve/sandbox";
import type { ToolContext } from "eve/tools";

import {
  watchedRepositorySchema,
  workingDocumentationRepositorySchema,
  type WatchedRepository,
  type WorkingDocumentationRepository,
} from "../agent/lib/repository-contract";
import {
  assertRepositoryMaterializationAllowed,
  cloneRepositoryCheckout,
  resolveRepositoryCommit,
  type RepositoryActionRecord,
  watchedRepositoryMaterializationPolicy,
  workingRepositoryMaterializationPolicy,
} from "../agent/lib/repository-materialization";
import { test } from "vitest";

test("repository materialization", async () => {
class FakeSandbox {
  readonly commands: string[] = [];
  readonly removedPaths: string[] = [];
  readonly networkPolicies: unknown[] = [];

  constructor(private readonly results: SandboxCommandResult[]) {}

  async run(input: { command: string }): Promise<SandboxCommandResult> {
    this.commands.push(input.command);
    const result = this.results.shift();
    assert.notEqual(result, undefined, `No fake result configured for: ${input.command}`);
    return result;
  }

  async removePath(input: { path: string }): Promise<void> {
    this.removedPaths.push(input.path);
  }

  async setNetworkPolicy(policy: unknown): Promise<void> {
    this.networkPolicies.push(policy);
  }
}

const workingRepository = workingDocumentationRepositorySchema.parse({
  source: { type: "github-url", url: "https://github.com/example/docs.git" },
  ref: "main",
  sandboxPath: "/workspace/working-docs",
});
const watchedRepository = watchedRepositorySchema.parse({
  id: "product-core",
  name: "Product Core",
  description: "Read-only product source evidence.",
  source: { type: "github-url", url: "https://github.com/example/core.git" },
  defaultRef: "main",
  sandboxPath: "/workspace/watched/product-core",
  provenanceLabel: "watched-repository:example/core",
});

assert.doesNotThrow(() =>
  assertRepositoryMaterializationAllowed(
    workingRepositoryMaterializationPolicy(workingRepository),
  ),
);
assert.doesNotThrow(() =>
  assertRepositoryMaterializationAllowed(
    watchedRepositoryMaterializationPolicy(watchedRepository, "v1.0.0", {
      mode: "public-github",
    }),
  ),
);

assert.throws(
  () =>
    assertRepositoryMaterializationAllowed(
      workingRepositoryMaterializationPolicy({
        ...workingRepository,
        sandboxPath: "/tmp/working-docs",
      } as WorkingDocumentationRepository),
    ),
  /Sandbox path must stay under \/workspace/,
);
assert.throws(
  () =>
    assertRepositoryMaterializationAllowed(
      watchedRepositoryMaterializationPolicy(
        {
          ...watchedRepository,
          sandboxPath: "/workspace/working-docs",
        } as WatchedRepository,
        "main",
        { mode: "public-github" },
      ),
    ),
  /Watched repository sandbox path must stay under \/workspace\/watched/,
);
assert.throws(
  () =>
    assertRepositoryMaterializationAllowed(
      watchedRepositoryMaterializationPolicy(
        {
          ...watchedRepository,
          allowedActions: ["read"],
        },
        "main",
        { mode: "public-github" },
      ),
    ),
  /Watched repository action is not allowed: clone/,
);

{
  const sandbox = new FakeSandbox([commandResult(0)]);
  const actionProvenance: RepositoryActionRecord[] = [];
  await cloneRepositoryCheckout(
    toolContext(sandbox),
    watchedRepositoryMaterializationPolicy(watchedRepository, "v1.0.0", {
      mode: "github-app",
      token: "installation-token",
    }),
    actionProvenance,
  );

  assert.equal(sandbox.networkPolicies.length, 1);
  const networkPolicy = JSON.stringify(sandbox.networkPolicies[0]);
  assert.match(networkPolicy, /github\.com/);
  assert.match(
    networkPolicy,
    new RegExp(Buffer.from("x-access-token:installation-token").toString("base64")),
  );
  assert.equal(networkPolicy.includes("installation-token"), false);
  assert.equal(sandbox.commands.length, 1);
  assert.equal(sandbox.commands[0].includes("installation-token"), false);
  assert.deepEqual(
    actionProvenance.map(({ action, status, target }) => ({ action, status, target })),
    [
      { action: "broker-github-token", status: "success", target: "github.com" },
      {
        action: "clone",
        status: "success",
        target: "/workspace/watched/product-core#v1.0.0",
      },
    ],
  );
}

{
  const sandbox = new FakeSandbox([commandResult(0)]);
  const actionProvenance: RepositoryActionRecord[] = [];
  await cloneRepositoryCheckout(
    toolContext(sandbox),
    watchedRepositoryMaterializationPolicy(watchedRepository, "main", {
      mode: "public-github",
    }),
    actionProvenance,
  );

  const networkPolicy = JSON.stringify(sandbox.networkPolicies[0]);
  assert.match(networkPolicy, /github\.com/);
  assert.equal(networkPolicy.includes("authorization"), false);
  assert.deepEqual(
    actionProvenance.map(({ action, status }) => ({ action, status })),
    [{ action: "clone", status: "success" }],
  );
}

{
  const sandbox = new FakeSandbox([
    commandResult(128, "", "Remote branch not found"),
    commandResult(0),
  ]);
  const actionProvenance: RepositoryActionRecord[] = [];
  await cloneRepositoryCheckout(
    toolContext(sandbox),
    workingRepositoryMaterializationPolicy(workingRepository),
    actionProvenance,
  );

  assert.equal(sandbox.removedPaths.length, 2);
  assert.match(sandbox.commands[0], /clone --depth=1 --branch/);
  assert.match(sandbox.commands[1], /git clone .* && git -C .* checkout/);
  assert.deepEqual(actionProvenance, [
    {
      action: "clone",
      provenanceLabel: "working-documentation-repository",
      status: "success",
      target: "/workspace/working-docs",
    },
  ]);
}

{
  const sandbox = new FakeSandbox([
    commandResult(128, "", "Shallow clone failed"),
    commandResult(128, "", "Checkout failed"),
  ]);
  const actionProvenance: RepositoryActionRecord[] = [];

  await assert.rejects(
    cloneRepositoryCheckout(
      toolContext(sandbox),
      workingRepositoryMaterializationPolicy(workingRepository),
      actionProvenance,
    ),
    /Failed to clone working documentation repository: Checkout failed/,
  );
  assert.deepEqual(
    actionProvenance.map(({ action, status, reason }) => ({ action, status, reason })),
    [{ action: "clone", status: "failure", reason: "Checkout failed" }],
  );
}

{
  const sandbox = new FakeSandbox([
    commandResult(128, "", "Tag clone failed"),
    commandResult(128, "", "Tag checkout failed"),
  ]);
  const actionProvenance: RepositoryActionRecord[] = [];

  await assert.rejects(
    cloneRepositoryCheckout(
      toolContext(sandbox),
      watchedRepositoryMaterializationPolicy(watchedRepository, "v-missing", {
        mode: "public-github",
      }),
      actionProvenance,
    ),
    /Failed to clone watched repository product-core: Tag checkout failed/,
  );
  assert.deepEqual(actionProvenance, [
    {
      action: "clone",
      provenanceLabel: "watched-repository:example/core",
      status: "failure",
      target: "https://github.com/example/core.git#v-missing",
      reason: "Tag checkout failed",
    },
  ]);
}

{
  const sandbox = new FakeSandbox([commandResult(0, "abc123\n")]);
  assert.equal(
    await resolveRepositoryCommit(toolContext(sandbox), "/workspace/working-docs"),
    "abc123",
  );
  assert.match(sandbox.commands[0], /rev-parse HEAD/);
}

console.log("Repository materialization checks passed.");

function toolContext(sandbox: FakeSandbox): ToolContext {
  return {
    abortSignal: new AbortController().signal,
    getSandbox: async () => sandbox,
  } as unknown as ToolContext;
}

function commandResult(
  exitCode: number,
  stdout = "",
  stderr = "",
): SandboxCommandResult {
  return { exitCode, stdout, stderr } as SandboxCommandResult;
}
});
