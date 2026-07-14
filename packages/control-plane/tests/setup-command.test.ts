import assert from "node:assert/strict";

import {
  parseSetupCommand,
  setupCommandUsage,
} from "../src/setup-command.ts";
import { test } from "vitest";

test("setup command", async () => {
assert.deepEqual(parseSetupCommand([]), { kind: "help" });
assert.deepEqual(parseSetupCommand(["status"]), { kind: "status" });
assert.deepEqual(parseSetupCommand(["configure", "--help"]), { kind: "help" });
assert.match(setupCommandUsage, /pnpm paige configure/);

const configure = parseSetupCommand([
  "configure",
  "--repository-url",
  "https://github.com/example/docs",
  "--github-connector",
  "github/paige",
  "--operator-login",
  "ExampleOperator",
  "--watched-repository",
  "https://github.com/example/product",
  "--context-repository",
  "https://github.com/example/decisions",
]);
assert.equal(configure.kind, "configure");
if (configure.kind === "configure") {
  assert.equal(configure.input.ref, "main");
  assert.equal(configure.input.docsRoot, undefined);
  assert.equal(configure.input.watchedRepositories.length, 1);
  assert.equal(configure.input.watchedRepositories[0]?.importance, "medium");
  assert.deepEqual(configure.input.watchedRepositories[0]?.signals, ["releases"]);
  assert.equal(configure.input.contextRepositories.length, 1);
  assert.equal(
    configure.input.contextRepositories[0]?.repositoryUrl,
    "https://github.com/example/decisions",
  );
  assert.equal(configure.operatorLogin, "ExampleOperator");
}

assert.throws(
  () => parseSetupCommand(["configure", "--repository-url", "https://github.com/example/docs"]),
  /--github-connector/,
);
assert.throws(() => parseSetupCommand(["unknown"]), /Unknown setup command/);

console.log("Setup command checks passed.");
});
