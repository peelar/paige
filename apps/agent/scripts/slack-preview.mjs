import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const agentRoot = fileURLToPath(new URL("..", import.meta.url));
const previewEnvironmentPath = fileURLToPath(
  new URL("../.env.preview.local", import.meta.url),
);

if (!existsSync(previewEnvironmentPath)) {
  console.error(
    "Missing apps/agent/.env.preview.local. Copy .env.preview.example and add the preview Slack app credentials.",
  );
  process.exit(1);
}

loadEnvFile(previewEnvironmentPath);

for (const name of [
  "PAIGE_SLACK_PREVIEW_BOT_TOKEN",
  "PAIGE_SLACK_PREVIEW_SIGNING_SECRET",
]) {
  if (!process.env[name]?.trim()) {
    console.error(`${name} is required in apps/agent/.env.preview.local.`);
    process.exit(1);
  }
}

const port = process.env.PAIGE_SLACK_PREVIEW_PORT?.trim() || "3000";
if (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65_535) {
  console.error("PAIGE_SLACK_PREVIEW_PORT must be a valid TCP port.");
  process.exit(1);
}

// Preview is explicit so a developer can never route the production Slack app
// to a local process merely by leaving an extra token in the environment.
const child = spawn(
  "pnpm",
  ["dev", "--host", "0.0.0.0", "--port", port],
  {
    cwd: agentRoot,
    env: { ...process.env, PAIGE_SLACK_MODE: "preview" },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error("Could not start the Slack preview agent.", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
