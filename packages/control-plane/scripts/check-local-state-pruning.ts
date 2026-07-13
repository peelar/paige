import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  findLocalStatePaths,
  isPaigeDevCommand,
  pruneLocalState,
} from "../src/local-state-pruning.ts";

assert.equal(isPaigeDevCommand("node /usr/local/bin/pnpm dev"), true);
assert.equal(isPaigeDevCommand("turbo run dev"), true);
assert.equal(isPaigeDevCommand("pnpm prune:local"), false);

const pruneRoot = await mkdtemp(join(tmpdir(), "paige-prune-check-"));
try {
  const removable = [
    ".docs-agent/docs-agent.sqlite",
    "apps/agent/.env.local",
    "apps/agent/.eve/state.json",
    "apps/agent/fixtures/example/.workflow-data/version.txt",
    "apps/web/.vercel/project.json",
  ];
  for (const path of removable) {
    const filePath = join(pruneRoot, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "test");
  }
  for (const path of [".git/.eve/keep", "node_modules/example/.eve/keep"]) {
    const filePath = join(pruneRoot, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "test");
  }

  const result = await pruneLocalState({
    repositoryRoot: pruneRoot,
    stopDevProcesses: false,
  });
  assert.deepEqual(await findLocalStatePaths(pruneRoot), []);
  assert.deepEqual(result.removedPaths, [
    ".docs-agent",
    "apps/agent/.env.local",
    "apps/agent/.eve",
    "apps/agent/fixtures/example/.workflow-data",
    "apps/web/.vercel",
  ]);
  assert.equal(result.stoppedDevProcesses.length, 0);
} finally {
  await rm(pruneRoot, { recursive: true, force: true });
}

console.log("Local state pruning checks passed.");
