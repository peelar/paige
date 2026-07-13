import { fileURLToPath } from "node:url";

import { pruneLocalState } from "../src/local-state-pruning.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

try {
  const result = await pruneLocalState({ repositoryRoot });
  const removedCount = result.removedPaths.length;
  const stoppedCount = result.stoppedDevProcesses.length;

  console.log("Prune successful.");
  if (stoppedCount > 0) {
    console.log(`Stopped ${stoppedCount} Paige dev ${stoppedCount === 1 ? "process" : "processes"}.`);
  }
  if (removedCount > 0) {
    console.log(`Removed ${removedCount} local setup ${removedCount === 1 ? "item" : "items"}:`);
    for (const path of result.removedPaths) console.log(`  - ${path}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
