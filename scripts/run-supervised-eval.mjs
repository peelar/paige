#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_NO_PROGRESS_MS = 2 * 60 * 1_000;
const DEFAULT_WALL_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_WALL_TIMEOUT_MS = 20 * 60 * 1_000;
const DEFAULT_TERM_GRACE_MS = 2_000;
const DEFAULT_MSB_TIMEOUT_MS = 15_000;
const MAX_TRANSCRIPT_BYTES = 64 * 1_024;
const SUPERVISOR_ERROR_EXIT_CODE = 70;
const TIMEOUT_EXIT_CODE = 124;
const EVE_SANDBOX_NAME = /^eve-sbx-(?:ses-|tpl-tmp-)/u;
const OPENING_SANDBOX_HEARTBEAT = /opening sandbox session/iu;

const config = readConfig();
const supervisorStartedAt = Date.now();
const cleanupReserveMs = Math.min(
  30_000,
  Math.max(1, Math.floor(config.wallTimeoutMs / 2)),
);
const executionDeadline =
  supervisorStartedAt + config.wallTimeoutMs - cleanupReserveMs;
const totalDeadline = supervisorStartedAt + config.wallTimeoutMs;
const owner = { nonce: randomUUID(), pid: process.pid };
let child;
let childStartedAt;
let lastProgressAt;
let stopReason;
let requestedSignal;
let forceKillTimer;
let workflowDirectory;
let baselineSandboxNames = new Set();
let baselineCaptured = false;
let lockHeld = false;
let transcript = "";
let cleanupPromise;
let executionWallTimer;

const signalHandlers = new Map([
  ["SIGHUP", () => requestStop("received SIGHUP", "SIGHUP")],
  ["SIGINT", () => requestStop("received SIGINT", "SIGINT")],
  ["SIGTERM", () => requestStop("received SIGTERM", "SIGTERM")],
]);

for (const [signal, handler] of signalHandlers) {
  process.on(signal, handler);
}

let exitCode = SUPERVISOR_ERROR_EXIT_CODE;

try {
  await acquireLock();
  workflowDirectory = await createWorkflowDirectory();
  startExecutionWallTimer();
  baselineSandboxNames = await listSandboxNames();
  baselineCaptured = true;
  if (stopReason) throw new Error(stopReason);
  exitCode = await runEval();
} catch (error) {
  stopReason ??= describeError(error);
  process.stderr.write(`Supervised eval failed: ${stopReason}\n`);
} finally {
  clearExecutionWallTimer();
  const cleanupErrors = await cleanup();
  if (Date.now() > totalDeadline) {
    cleanupErrors.push(
      `total wall-clock budget of ${config.wallTimeoutMs}ms was exceeded during cleanup`,
    );
  }
  if (cleanupErrors.length > 0) {
    stopReason = [stopReason, ...cleanupErrors].filter(Boolean).join("; ");
    process.stderr.write(`Supervised eval cleanup failed: ${cleanupErrors.join("; ")}\n`);
    exitCode = SUPERVISOR_ERROR_EXIT_CODE;
  }

  if (exitCode !== 0 || stopReason) {
    try {
      const logPath = await writeFailureLog(exitCode);
      process.stderr.write(`Supervised eval failure log: ${logPath}\n`);
    } catch (error) {
      process.stderr.write(
        `Could not write supervised eval failure log: ${describeError(error)}\n`,
      );
      exitCode = SUPERVISOR_ERROR_EXIT_CODE;
    }
  }

  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

process.exitCode = requestedSignal
  ? requestedSignal === "SIGHUP"
    ? 129
    : requestedSignal === "SIGINT"
      ? 130
      : 143
  : exitCode;

function readConfig() {
  const wallTimeoutMs = readPositiveInteger(
    "PAIGE_EVAL_WALL_TIMEOUT_MS",
    DEFAULT_WALL_TIMEOUT_MS,
  );
  if (wallTimeoutMs > MAX_WALL_TIMEOUT_MS) {
    throw new Error(
      `PAIGE_EVAL_WALL_TIMEOUT_MS cannot exceed ${MAX_WALL_TIMEOUT_MS}ms.`,
    );
  }

  const childArgsOverride = process.env.PAIGE_EVAL_CHILD_ARGS_JSON;
  let childArgs;
  if (childArgsOverride) {
    const parsed = JSON.parse(childArgsOverride);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new Error("PAIGE_EVAL_CHILD_ARGS_JSON must be a JSON array of strings.");
    }
    childArgs = parsed;
  } else {
    const evalArgs = process.argv.slice(2);
    if (evalArgs[0] === "--") evalArgs.shift();
    childArgs = ["--filter", "docs-agent", "eval", ...evalArgs];
  }

  return {
    childArgs,
    childCommand: process.env.PAIGE_EVAL_CHILD_COMMAND ?? "pnpm",
    failureDirectory:
      process.env.PAIGE_EVAL_FAILURE_DIR ??
      join(repositoryRoot, ".eve", "eval-supervisor", "failures"),
    lockDirectory:
      process.env.PAIGE_EVAL_LOCK_DIR ??
      join(tmpdir(), "paige-supervised-eval.lock"),
    msbBinary:
      process.env.PAIGE_EVAL_MSB_BINARY ??
      join(repositoryRoot, "apps", "agent", "node_modules", ".bin", "msb"),
    msbTimeoutMs: readPositiveInteger(
      "PAIGE_EVAL_MSB_TIMEOUT_MS",
      DEFAULT_MSB_TIMEOUT_MS,
    ),
    noProgressMs: readPositiveInteger(
      "PAIGE_EVAL_NO_PROGRESS_MS",
      DEFAULT_NO_PROGRESS_MS,
    ),
    termGraceMs: readPositiveInteger(
      "PAIGE_EVAL_TERM_GRACE_MS",
      DEFAULT_TERM_GRACE_MS,
    ),
    wallTimeoutMs,
    workflowParent: process.env.PAIGE_EVAL_WORKFLOW_PARENT ?? tmpdir(),
  };
}

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

async function acquireLock() {
  await mkdir(dirname(config.lockDirectory), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(config.lockDirectory);
      await writeFile(
        join(config.lockDirectory, "owner.json"),
        `${JSON.stringify(owner)}\n`,
        { flag: "wx" },
      );
      lockHeld = true;
      return;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt > 0) throw error;
      const existingOwner = await readLockOwner();
      if (existingOwner?.pid && isProcessRunning(existingOwner.pid)) {
        throw new Error(
          `another supervised eval owns ${config.lockDirectory} (pid ${existingOwner.pid})`,
        );
      }
      await rm(config.lockDirectory, { force: true, recursive: true });
    }
  }
}

async function readLockOwner() {
  try {
    return JSON.parse(await readFile(join(config.lockDirectory, "owner.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function createWorkflowDirectory() {
  await mkdir(config.workflowParent, { recursive: true });
  return mkdtemp(join(config.workflowParent, "paige-supervised-eval-"));
}

async function runEval() {
  const commandText = formatCommand(config.childCommand, config.childArgs);
  process.stdout.write(
    `Supervised eval: ${commandText}\n` +
      `No-progress timeout: ${config.noProgressMs}ms; wall timeout: ${config.wallTimeoutMs}ms\n`,
  );

  childStartedAt = Date.now();
  lastProgressAt = childStartedAt;
  child = spawn(config.childCommand, config.childArgs, {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      WORKFLOW_LOCAL_DATA_DIR: workflowDirectory,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  observeOutput(child.stdout, process.stdout);
  observeOutput(child.stderr, process.stderr);

  const childResult = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });

  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressAt >= config.noProgressMs) {
      requestStop(`no meaningful progress for ${config.noProgressMs}ms`);
    }
  }, Math.min(1_000, Math.max(10, Math.floor(config.noProgressMs / 4))));
  watchdog.unref();

  let result;
  try {
    result = await childResult;
  } finally {
    clearInterval(watchdog);
    clearExecutionWallTimer();
    await finishProcessGroup();
  }

  if (stopReason) {
    process.stderr.write(`Supervised eval stopped: ${stopReason}\n`);
    return TIMEOUT_EXIT_CODE;
  }
  if (result.code !== null) return result.code;

  stopReason = `eval exited from ${result.signal ?? "an unknown signal"}`;
  return 1;
}

function observeOutput(stream, destination) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    destination.write(chunk);
    appendTranscript(chunk);
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (isMeaningfulProgress(line)) lastProgressAt = Date.now();
    }
  });
  stream.on("end", () => {
    if (isMeaningfulProgress(pending)) lastProgressAt = Date.now();
  });
}

function isMeaningfulProgress(line) {
  const normalized = line.trim();
  return normalized.length > 0 && !OPENING_SANDBOX_HEARTBEAT.test(normalized);
}

function appendTranscript(chunk) {
  transcript += chunk;
  if (Buffer.byteLength(transcript) <= MAX_TRANSCRIPT_BYTES) return;
  transcript = Buffer.from(transcript).subarray(-MAX_TRANSCRIPT_BYTES).toString("utf8");
}

function requestStop(reason, signal) {
  if (signal) requestedSignal ??= signal;
  if (stopReason) return;
  stopReason = reason;
  if (!child?.pid) return;
  signalProcessGroup(child.pid, "SIGTERM");
  forceKillTimer = setTimeout(() => {
    signalProcessGroup(child.pid, "SIGKILL");
  }, config.termGraceMs);
  forceKillTimer.unref();
}

async function finishProcessGroup() {
  if (!child?.pid) return;

  if (forceKillTimer) {
    await delayWithinDeadline(config.termGraceMs);
    clearTimeout(forceKillTimer);
  } else {
    signalProcessGroup(child.pid, "SIGTERM");
    await delayWithinDeadline(config.termGraceMs);
  }
  signalProcessGroup(child.pid, "SIGKILL");
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = performCleanup();
  return cleanupPromise;
}

async function performCleanup() {
  const errors = [];

  try {
    if (child?.pid) signalProcessGroup(child.pid, "SIGKILL");
  } catch (error) {
    errors.push(`process cleanup: ${describeError(error)}`);
  }

  try {
    await removeRunSandboxes();
  } catch (error) {
    errors.push(`sandbox cleanup: ${describeError(error)}`);
  }

  if (workflowDirectory) {
    try {
      await rm(workflowDirectory, { force: true, recursive: true });
    } catch (error) {
      errors.push(`workflow cleanup: ${describeError(error)}`);
    }
  }

  if (lockHeld) {
    try {
      const currentOwner = await readLockOwner();
      if (currentOwner?.nonce !== owner.nonce) {
        throw new Error("lock ownership changed before cleanup");
      }
      await rm(config.lockDirectory, { force: true, recursive: true });
      lockHeld = false;
    } catch (error) {
      errors.push(`lock cleanup: ${describeError(error)}`);
    }
  }

  return errors;
}

async function removeRunSandboxes() {
  if (!lockHeld || !baselineCaptured || !childStartedAt) return;
  const currentNames = await listSandboxNames();
  const ownedNames = [...currentNames].filter(
    (name) => EVE_SANDBOX_NAME.test(name) && !baselineSandboxNames.has(name),
  );
  if (ownedNames.length === 0) return;

  await runMsb(["remove", "--force", "--quiet", ...ownedNames]);
  const remainingNames = await listSandboxNames();
  const lingering = ownedNames.filter((name) => remainingNames.has(name));
  if (lingering.length > 0) {
    throw new Error(`sandbox resources remain: ${lingering.join(", ")}`);
  }
}

async function listSandboxNames() {
  await access(config.msbBinary, fsConstants.X_OK);
  const { stdout } = await runMsb(["list", "--format", "json"]);
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("msb list did not return an array");

  return new Set(
    parsed.map((entry) => entry?.name).filter((name) => typeof name === "string"),
  );
}

function runMsb(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeoutMs = Math.min(config.msbTimeoutMs, remainingTotalMs());
    if (timeoutMs <= 0) {
      rejectPromise(new Error(`msb ${args[0]} had no time left in the wall-clock budget`));
      return;
    }
    const command = spawn(config.msbBinary, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      command.kill("SIGKILL");
      settle(new Error(`msb ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    command.stdout.setEncoding("utf8");
    command.stderr.setEncoding("utf8");
    command.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    command.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    command.once("error", settle);
    command.once("close", (code, signal) => {
      if (code === 0) settle(undefined, { stdout, stderr });
      else {
        settle(
          new Error(
            `msb ${args[0]} exited ${code ?? signal}: ${stderr.trim() || stdout.trim()}`,
          ),
        );
      }
    });

    function settle(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise(result);
    }
  });
}

async function writeFailureLog(code) {
  await mkdir(config.failureDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const path = join(config.failureDirectory, `${stamp}-${process.pid}.log`);
  const content = [
    `command: ${formatCommand(config.childCommand, config.childArgs)}`,
    `exitCode: ${code}`,
    `reason: ${stopReason ?? "child process failed"}`,
    `startedAt: ${childStartedAt ? new Date(childStartedAt).toISOString() : "not started"}`,
    `workflowDirectory: ${workflowDirectory ?? "not created"}`,
    "",
    "last output:",
    transcript,
  ].join("\n");
  await writeFile(path, content);
  return path;
}

function formatCommand(command, args) {
  return [command, ...args].map((value) => JSON.stringify(value)).join(" ");
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function startExecutionWallTimer() {
  const timeoutMs = Math.max(1, executionDeadline - Date.now());
  executionWallTimer = setTimeout(() => {
    requestStop(
      `wall-clock timeout: execution budget exhausted with ${cleanupReserveMs}ms reserved for cleanup`,
    );
  }, timeoutMs);
  executionWallTimer.unref();
}

function clearExecutionWallTimer() {
  if (!executionWallTimer) return;
  clearTimeout(executionWallTimer);
  executionWallTimer = undefined;
}

function remainingTotalMs() {
  return Math.max(0, totalDeadline - Date.now());
}

function delayWithinDeadline(ms) {
  return delay(Math.min(ms, remainingTotalMs()));
}
