import type { ToolContext } from "eve/tools";

import {
  quoteShellArgument as sh,
  RepositoryPolicyError,
  summarizeCommandFailure,
} from "./repository-materialization";

export type RepositoryPathExpectation = "file" | "directory" | "file-or-create";

export async function assertSafeRepositoryPath(
  ctx: ToolContext,
  repository: { sandboxPath: string },
  relativePath: string,
  expected: RepositoryPathExpectation,
): Promise<void> {
  const sandbox = await ctx.getSandbox();
  const result = await sandbox.run({
    command: [
      "node",
      "-e",
      sh(PATH_POLICY_SCRIPT),
      "--",
      sh(repository.sandboxPath),
      sh(relativePath),
      sh(expected),
    ].join(" "),
    abortSignal: AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(30_000)]),
  });
  if (result.exitCode !== 0) {
    throw new RepositoryPolicyError(summarizeCommandFailure(result));
  }
}

const PATH_POLICY_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const [root, relative, expected] = process.argv.slice(1);
try {
  const rootReal = fs.realpathSync(root);
  const candidate = path.resolve(rootReal, relative === "." ? "" : relative);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    throw new Error("Path escapes the configured working repository.");
  }
  let current = rootReal;
  let missing = false;
  for (const part of relative === "." ? [] : relative.split("/")) {
    current = path.join(current, part);
    if (missing) continue;
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        missing = true;
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error("Symbolic links are not allowed through the working repository capability.");
    }
    if (current !== candidate && !stat.isDirectory()) {
      throw new Error("A repository path parent is not a directory.");
    }
  }
  if (expected === "file-or-create") {
    if (!missing && !fs.statSync(candidate).isFile()) throw new Error("Path is not a regular file.");
  } else {
    if (missing) throw new Error("Repository path does not exist.");
    const stat = fs.statSync(candidate);
    if (expected === "file" && !stat.isFile()) throw new Error("Path is not a regular file.");
    if (expected === "directory" && !stat.isDirectory()) throw new Error("Path is not a directory.");
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
