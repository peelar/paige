#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = join(repositoryRoot, "scripts", "run-supervised-eval.mjs");
const testRoot = await mkdtemp(join(tmpdir(), "paige-eval-supervisor-test-"));
const fakeChildPath = join(testRoot, "fake-eval.mjs");
const fakeMsbPath = join(testRoot, "fake-msb.mjs");

try {
  await writeExecutable(fakeChildPath, fakeChildSource());
  await writeExecutable(fakeMsbPath, fakeMsbSource());

  await testSuccessfulRunAndCleanup();
  await testChildExitCodeIsPreserved();
  await testNoProgressTimeoutKillsProcessTree();
  await testWallTimeoutDespiteProgress();
  await testCleanupFailureFailsClosed();
  await testBaselineFailurePreservesExistingResources();
  await testLiveLockFailsClosed();
  await testPnpmProcessGroupInterruptCleansUp();

  console.log("Supervised eval runner checks passed.");
} finally {
  await rm(testRoot, { force: true, recursive: true });
}

async function testSuccessfulRunAndCleanup() {
  const fixture = await createFixture("success");
  const result = await runFixture(fixture, {
    FAKE_EVAL_SCENARIO: "success",
    FAKE_EVAL_SANDBOX_NAME: "eve-sbx-ses-owned-success",
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /meaningful eval progress/u);
  await assertCleanup(fixture, ["preexisting-sandbox"]);
  assert.deepEqual(await readRemovalLog(fixture), ["eve-sbx-ses-owned-success"]);
  assert.deepEqual(await readdir(fixture.failureDirectory), []);
}

async function testChildExitCodeIsPreserved() {
  const fixture = await createFixture("exit-code");
  const result = await runFixture(fixture, {
    FAKE_EVAL_EXIT_CODE: "7",
    FAKE_EVAL_SCENARIO: "success",
    FAKE_EVAL_SANDBOX_NAME: "eve-sbx-ses-owned-failure",
  });

  assert.equal(result.code, 7, result.stderr);
  await assertCleanup(fixture, ["preexisting-sandbox"]);
  const failureLog = await readOnlyFailureLog(fixture);
  assert.match(failureLog, /exitCode: 7/u);
  assert.match(failureLog, /meaningful eval progress/u);
}

async function testNoProgressTimeoutKillsProcessTree() {
  const fixture = await createFixture("no-progress");
  const result = await runFixture(fixture, {
    FAKE_EVAL_SCENARIO: "heartbeat",
    FAKE_EVAL_SANDBOX_NAME: "eve-sbx-ses-owned-heartbeat",
  });

  assert.equal(result.code, 124, result.stderr);
  assert.match(result.stderr, /no meaningful progress/u);
  await assertProcessTreeStopped(fixture.pidFile);
  await assertCleanup(fixture, ["preexisting-sandbox"]);
  assert.deepEqual(await readRemovalLog(fixture), ["eve-sbx-ses-owned-heartbeat"]);
  assert.match(await readOnlyFailureLog(fixture), /no meaningful progress/u);
}

async function testWallTimeoutDespiteProgress() {
  const fixture = await createFixture("wall-timeout");
  const result = await runFixture(
    fixture,
    {
      FAKE_EVAL_SCENARIO: "progress-forever",
      FAKE_EVAL_SANDBOX_NAME: "eve-sbx-ses-owned-wall",
      PAIGE_EVAL_NO_PROGRESS_MS: "3000",
      PAIGE_EVAL_WALL_TIMEOUT_MS: "1500",
    },
  );

  assert.equal(result.code, 124, result.stderr);
  assert.match(result.stderr, /wall-clock timeout/u);
  await assertProcessTreeStopped(fixture.pidFile);
  await assertCleanup(fixture, ["preexisting-sandbox"]);
  assert.match(await readOnlyFailureLog(fixture), /wall-clock timeout/u);
}

async function testCleanupFailureFailsClosed() {
  const fixture = await createFixture("cleanup-failure");
  const result = await runFixture(fixture, {
    FAKE_EVAL_SCENARIO: "success",
    FAKE_EVAL_SANDBOX_NAME: "eve-sbx-ses-owned-cleanup-failure",
    FAKE_MSB_FAIL_REMOVE: "1",
  });

  assert.equal(result.code, 70, result.stderr);
  assert.match(result.stderr, /sandbox cleanup/u);
  assert.deepEqual(await readSandboxNames(fixture), [
    "eve-sbx-ses-owned-cleanup-failure",
    "preexisting-sandbox",
  ]);
  assert.deepEqual(await readdir(fixture.workflowParent), []);
  await assertMissing(fixture.lockDirectory);
  assert.match(await readOnlyFailureLog(fixture), /sandbox cleanup/u);
}

async function testBaselineFailurePreservesExistingResources() {
  const fixture = await createFixture("baseline-failure");
  const result = await runFixture(fixture, {
    FAKE_EVAL_SCENARIO: "success",
    FAKE_MSB_FAIL_LIST: "1",
  });

  assert.equal(result.code, 70, result.stderr);
  assert.match(result.stderr, /msb list exited 9/u);
  assert.deepEqual(await readSandboxNames(fixture), ["preexisting-sandbox"]);
  assert.deepEqual(await readdir(fixture.workflowParent), []);
  await assertMissing(fixture.lockDirectory);
  assert.deepEqual(await readRemovalLog(fixture), []);
}

async function testLiveLockFailsClosed() {
  const fixture = await createFixture("live-lock");
  await mkdir(fixture.lockDirectory);
  await writeFile(
    join(fixture.lockDirectory, "owner.json"),
    `${JSON.stringify({ nonce: "another-run", pid: process.pid })}\n`,
  );

  const result = await runFixture(fixture, { FAKE_EVAL_SCENARIO: "success" });
  assert.equal(result.code, 70, result.stderr);
  assert.match(result.stderr, /another supervised eval owns/u);
  assert.deepEqual(await readSandboxNames(fixture), ["preexisting-sandbox"]);
  assert.deepEqual(await readdir(fixture.workflowParent), []);
  assert.deepEqual(await readRemovalLog(fixture), []);
}

async function testPnpmProcessGroupInterruptCleansUp() {
  const fixture = await createFixture("pnpm-interrupt");
  const environment = fixtureEnvironment(fixture, {
    FAKE_EVAL_SCENARIO: "heartbeat",
    FAKE_EVAL_SANDBOX_NAME: "eve-sbx-ses-owned-interrupt",
  });
  const pnpmEntry = process.env.npm_execpath;
  const command = pnpmEntry
    ? spawn(process.execPath, [pnpmEntry, "eval:safe"], {
        cwd: repositoryRoot,
        detached: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn("pnpm", ["eval:safe"], {
        cwd: repositoryRoot,
        detached: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
  let stderr = "";
  command.stderr.setEncoding("utf8");
  command.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  command.stdout.resume();

  await waitForFile(fixture.pidFile);
  process.kill(-command.pid, "SIGINT");
  await waitForClose(command, 5_000);

  await assertProcessTreeStopped(fixture.pidFile);
  await assertCleanup(fixture, ["preexisting-sandbox"]);
  assert.deepEqual(await readRemovalLog(fixture), ["eve-sbx-ses-owned-interrupt"]);
  assert.match(await readOnlyFailureLog(fixture), /received SIGINT|received SIGHUP/u);
  assert.doesNotMatch(stderr, /cleanup failed/u);
}

async function createFixture(name) {
  const root = join(testRoot, name);
  const failureDirectory = join(root, "failures");
  const lockDirectory = join(root, "supervisor.lock");
  const msbLog = join(root, "msb-removals.jsonl");
  const msbState = join(root, "msb-state.json");
  const pidFile = join(root, "pids.txt");
  const workflowParent = join(root, "workflow");
  await mkdir(failureDirectory, { recursive: true });
  await mkdir(workflowParent, { recursive: true });
  await writeFile(
    msbState,
    `${JSON.stringify([{ name: "preexisting-sandbox", status: "Stopped" }])}\n`,
  );
  await writeFile(msbLog, "");

  return {
    failureDirectory,
    lockDirectory,
    msbLog,
    msbState,
    pidFile,
    root,
    workflowParent,
  };
}

async function runFixture(fixture, overrides) {
  const environment = fixtureEnvironment(fixture, overrides);

  return new Promise((resolvePromise, rejectPromise) => {
    const command = spawn(process.execPath, [runnerPath], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      command.kill("SIGKILL");
      rejectPromise(new Error(`runner fixture ${fixture.root} exceeded 5 seconds`));
    }, 5_000);

    command.stdout.setEncoding("utf8");
    command.stderr.setEncoding("utf8");
    command.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    command.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    command.once("error", rejectPromise);
    command.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ code, signal, stderr, stdout });
    });
  });
}

function fixtureEnvironment(fixture, overrides) {
  return {
    ...process.env,
    FAKE_EVAL_PID_FILE: fixture.pidFile,
    FAKE_MSB_LOG: fixture.msbLog,
    FAKE_MSB_STATE: fixture.msbState,
    PAIGE_EVAL_CHILD_ARGS_JSON: "[]",
    PAIGE_EVAL_CHILD_COMMAND: fakeChildPath,
    PAIGE_EVAL_FAILURE_DIR: fixture.failureDirectory,
    PAIGE_EVAL_LOCK_DIR: fixture.lockDirectory,
    PAIGE_EVAL_MSB_BINARY: fakeMsbPath,
    PAIGE_EVAL_MSB_TIMEOUT_MS: "500",
    PAIGE_EVAL_NO_PROGRESS_MS: "1000",
    PAIGE_EVAL_TERM_GRACE_MS: "50",
    PAIGE_EVAL_WALL_TIMEOUT_MS: "4000",
    PAIGE_EVAL_WORKFLOW_PARENT: fixture.workflowParent,
    ...overrides,
  };
}

function waitForClose(command, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      command.kill("SIGKILL");
      rejectPromise(new Error(`process ${command.pid} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    command.once("error", rejectPromise);
    command.once("close", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function waitForFile(path) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(20);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function assertCleanup(fixture, expectedSandboxNames) {
  assert.deepEqual(await readSandboxNames(fixture), expectedSandboxNames);
  assert.deepEqual(await readdir(fixture.workflowParent), []);
  await assertMissing(fixture.lockDirectory);
}

async function readSandboxNames(fixture) {
  const state = JSON.parse(await readFile(fixture.msbState, "utf8"));
  return state.map((entry) => entry.name).toSorted();
}

async function readRemovalLog(fixture) {
  const contents = await readFile(fixture.msbLog, "utf8");
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line));
}

async function readOnlyFailureLog(fixture) {
  const entries = await readdir(fixture.failureDirectory);
  assert.equal(entries.length, 1, `expected one failure log, found ${entries.length}`);
  const contents = await readFile(join(fixture.failureDirectory, entries[0]), "utf8");
  assert.ok(Buffer.byteLength(contents) < 70 * 1_024, "failure log must stay bounded");
  return contents;
}

async function assertProcessTreeStopped(pidFile) {
  const pids = (await readFile(pidFile, "utf8"))
    .trim()
    .split("\n")
    .map(Number);
  const deadline = Date.now() + 1_000;
  while (pids.some(isProcessRunning) && Date.now() < deadline) {
    await delay(20);
  }
  assert.deepEqual(
    pids.filter(isProcessRunning),
    [],
    `processes still running: ${pids.filter(isProcessRunning).join(", ")}`,
  );
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function assertMissing(path) {
  await assert.rejects(readFile(path), (error) => error?.code === "EISDIR" || error?.code === "ENOENT");
  try {
    await readdir(path);
    assert.fail(`${path} still exists`);
  } catch (error) {
    assert.equal(error?.code, "ENOENT");
  }
}

async function writeExecutable(path, contents) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function fakeChildSource() {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const statePath = process.env.FAKE_MSB_STATE;
const sandboxName = process.env.FAKE_EVAL_SANDBOX_NAME;
if (sandboxName) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.push({ name: sandboxName, status: "Running" });
  await writeFile(statePath, JSON.stringify(state));
}

const scenario = process.env.FAKE_EVAL_SCENARIO;
if (scenario === "success") {
  console.log("meaningful eval progress");
  process.exit(Number(process.env.FAKE_EVAL_EXIT_CODE ?? "0"));
}

const grandchild = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  { stdio: "ignore" },
);
await writeFile(process.env.FAKE_EVAL_PID_FILE, \`${"${process.pid}"}\\n${"${grandchild.pid}"}\\n\`);
process.on("SIGTERM", () => {});

if (scenario === "heartbeat") {
  console.error('eve: opening sandbox session "root" on backend "microsandbox"...');
  setInterval(() => {
    console.error('eve: opening sandbox session "root" on backend "microsandbox"...');
  }, 20);
} else if (scenario === "progress-forever") {
  let tick = 0;
  setInterval(() => console.log(\`eval progress ${"${tick += 1}"}\`), 20);
} else {
  throw new Error(\`unknown fake scenario: ${"${scenario}"}\`);
}
`;
}

function fakeMsbSource() {
  return `#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";

const [command, ...args] = process.argv.slice(2);
const statePath = process.env.FAKE_MSB_STATE;
const state = JSON.parse(await readFile(statePath, "utf8"));

if (command === "list") {
  if (process.env.FAKE_MSB_FAIL_LIST === "1") process.exit(9);
  process.stdout.write(JSON.stringify(state));
  process.exit(0);
}

if (command === "remove") {
  if (process.env.FAKE_MSB_FAIL_REMOVE === "1") process.exit(9);
  const names = args.filter((arg) => !arg.startsWith("-"));
  await appendFile(process.env.FAKE_MSB_LOG, \`${"${JSON.stringify(names)}"}\\n\`);
  await writeFile(
    statePath,
    JSON.stringify(state.filter((entry) => !names.includes(entry.name))),
  );
  process.exit(0);
}

console.error(\`unsupported fake msb command: ${"${command}"}\`);
process.exit(2);
`;
}
