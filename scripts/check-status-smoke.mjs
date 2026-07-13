import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const processes = [];
const port = await findAvailablePort();
const portlessStateDirectory = await mkdtemp(
  join(tmpdir(), "paige-status-smoke-portless-"),
);
const agentUrl = `http://agent.paige.localhost:${port}`;
const webUrl = `http://paige.localhost:${port}`;

try {
  const agent = start("agent", ["dev:agent", "--no-ui"]);
  await waitForUrl(`${agentUrl}/eve/v1/health`, agent);

  const web = start("web", ["dev:web"]);
  await waitForUrl(`${webUrl}/status`, web);

  const response = await fetch(`${webUrl}/status`);
  if (!response.ok) throw new Error(`Status page returned ${response.status}.`);
  const html = await response.text();

  assertReadinessState(html, "database", "verified");
  assertReadinessState(html, "eve-runtime", "reachable");

  console.log("Local status smoke checks passed.");
} finally {
  await Promise.all(processes.map(stop));
  try {
    await stopProxy();
  } finally {
    await rm(portlessStateDirectory, { recursive: true, force: true });
  }
}

function start(label, args) {
  const child = spawn("pnpm", args, {
    cwd: repositoryRoot,
    detached: true,
    env: {
      ...process.env,
      DOCS_AGENT_OPERATOR_ACCESS: "local",
      DOCS_AGENT_READINESS_TEST_SCENARIOS: "",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      PORTLESS_HTTPS: "0",
      PORTLESS_PORT: String(port),
      PORTLESS_STATE_DIR: portlessStateDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = { child, label, output: "" };
  processes.push(record);

  const append = (chunk) => {
    record.output = `${record.output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  return record;
}

async function stopProxy() {
  const child = spawn("pnpm", ["exec", "portless", "proxy", "stop"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PORTLESS_STATE_DIR: portlessStateDirectory,
    },
    stdio: "ignore",
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error("Could not stop the isolated Portless proxy.");
}

function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local status smoke port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function waitForUrl(url, processRecord) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (processRecord.child.exitCode !== null) {
      throw new Error(
        `${processRecord.label} exited before ${url} became ready.\n${processRecord.output}`,
      );
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(
    `Timed out waiting for ${url}.\n${processRecord.output}`,
  );
}

function assertReadinessState(html, id, expectedState) {
  const itemPattern = new RegExp(
    `data-readiness-id=["']${id}["'][^>]*data-readiness-state=["']([^"']+)["']`,
  );
  const state = itemPattern.exec(html)?.[1];
  if (state !== expectedState) {
    throw new Error(
      `Expected ${id} to be ${expectedState} through the Status page, received ${state ?? "no result"}.`,
    );
  }
}

async function stop(record) {
  const pid = record.child.pid;
  if (pid === undefined || record.child.exitCode !== null) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }

  await Promise.race([
    new Promise((resolveExit) => record.child.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000)),
  ]);

  if (record.child.exitCode === null) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process already exited.
    }
  }
}
