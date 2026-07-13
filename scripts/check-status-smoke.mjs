import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const processes = [];

try {
  const agent = start("agent", ["dev:agent", "--no-ui"]);
  await waitForUrl("http://agent.paige.localhost:1355/eve/v1/health", agent);

  const web = start("web", ["dev:web"]);
  await waitForUrl("http://paige.localhost:1355/status", web);

  const response = await fetch("http://paige.localhost:1355/status");
  if (!response.ok) throw new Error(`Status page returned ${response.status}.`);
  const html = await response.text();

  assertReadinessState(html, "database", "verified");
  assertReadinessState(html, "eve-runtime", "reachable");

  console.log("Local status smoke checks passed.");
} finally {
  await Promise.all(processes.map(stop));
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
