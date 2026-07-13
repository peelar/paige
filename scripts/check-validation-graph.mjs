import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "turbo", "run", "typecheck", "test", "test:e2e", "--dry=json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
  },
);

if (result.status !== 0) {
  throw new Error(
    `Turbo validation graph inspection failed.\n${result.stdout}${result.stderr}`.trim(),
  );
}

const graph = JSON.parse(result.stdout);
const tasks = new Map(graph.tasks.map((task) => [task.taskId, task]));
const rootPackage = readPackage("package.json");
const packages = new Map([
  [
    "@docs-agent/control-plane",
    readPackage("packages/control-plane/package.json"),
  ],
  ["@docs-agent/web", readPackage("apps/web/package.json")],
  ["docs-agent", readPackage("apps/agent/package.json")],
]);

assert.deepEqual(
  taskIds("build"),
  [
    "@docs-agent/control-plane#build",
    "@docs-agent/web#build",
    "docs-agent#build",
  ],
  "The browser suite must schedule exactly one build for every workspace package.",
);
assert.deepEqual(
  taskIds("typecheck"),
  [
    "@docs-agent/control-plane#typecheck",
    "@docs-agent/web#typecheck",
    "docs-agent#typecheck",
  ],
  "Every workspace package must participate in typechecking.",
);
assert.deepEqual(
  taskIds("test"),
  ["@docs-agent/control-plane#test", "docs-agent#test"],
  "Only packages with deterministic Vitest suites should participate in the fast test task.",
);
assert.deepEqual(
  taskIds("test:e2e"),
  ["@docs-agent/web#test:e2e"],
  "The browser suite must remain a distinct web-only handoff task.",
);

for (const packageName of packages.keys()) {
  const typecheck = tasks.get(`${packageName}#typecheck`);
  assert.ok(typecheck, `Turbo is missing ${packageName}#typecheck.`);
  assert.deepEqual(
    typecheck.dependencies,
    [],
    `${packageName}#typecheck must stay independent from builds.`,
  );

  const packageJson = packages.get(packageName);
  assert.equal(
    typeof packageJson.scripts?.check,
    "string",
    `${packageName} is missing a focused package check.`,
  );
  assert.doesNotMatch(
    packageJson.scripts.check,
    /\bbuild\b/u,
    `${packageName}#check must not hide a build command.`,
  );
}

for (const packageName of ["@docs-agent/control-plane", "docs-agent"]) {
  const test = tasks.get(`${packageName}#test`);
  assert.ok(test, `Turbo is missing ${packageName}#test.`);
  assert.deepEqual(
    test.dependencies,
    [],
    `${packageName}#test must run without a prerequisite build.`,
  );
  assert.match(
    packages.get(packageName).scripts.test,
    /vitest run/u,
    `${packageName} must run deterministic checks through Vitest.`,
  );
}

assert.deepEqual(
  tasks.get("@docs-agent/web#test:e2e")?.dependencies,
  ["@docs-agent/web#build"],
  "The browser suite must consume the web build through Turbo.",
);

for (const appName of ["@docs-agent/web", "docs-agent"]) {
  assert.deepEqual(
    tasks.get(`${appName}#build`)?.dependencies,
    ["@docs-agent/control-plane#build"],
    `${appName}#build must share Turbo's control-plane build dependency.`,
  );
}

assert.deepEqual(
  tasks.get("@docs-agent/control-plane#build")?.dependencies,
  [],
  "The control-plane build must be the validation graph root.",
);

assert.match(rootPackage.scripts.check, /turbo run typecheck test --affected/u);
assert.match(rootPackage.scripts.check, /pnpm capability:check/u);
assert.doesNotMatch(rootPackage.scripts.check, /test:e2e|monorepo:smoke|status:smoke/u);
assert.match(rootPackage.scripts["check:full"], /turbo run typecheck test build test:e2e/u);
assert.match(rootPackage.scripts["check:full"], /pnpm capability:check/u);
assert.doesNotMatch(rootPackage.scripts["check:full"], /--affected/u);
assert.match(packages.get("docs-agent").scripts.build, /eve build/u);
assert.match(packages.get("@docs-agent/web").scripts.build, /next build/u);

console.log("Turbo validation graph checks passed.");

function readPackage(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}

function taskIds(taskName) {
  return graph.tasks
    .filter((task) => task.task === taskName && task.command !== "<NONEXISTENT>")
    .map((task) => task.taskId)
    .toSorted();
}
