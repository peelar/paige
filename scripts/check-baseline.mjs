import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentRoot = join(root, "apps", "agent", "agent");
const expectedAgentFiles = [
  "agent.ts",
  "channels/eve.ts",
  "channels/slack.ts",
  "instructions.md",
  "sandbox.ts",
];

assert.deepEqual(walk(agentRoot), expectedAgentFiles, "the authored Eve surface drifted");

for (const removed of [
  ".agents",
  ".codex",
  "docs",
  "packages/control-plane",
  "apps/agent/agent/lib",
  "apps/agent/agent/tools",
  "apps/agent/agent/skills",
]) {
  assert.equal(existsSync(join(root, removed)), false, `${removed} must stay absent`);
}

assert.equal(existsSync(join(root, "MANIFEST.md")), true, "MANIFEST.md must exist");

const slack = readFileSync(join(agentRoot, "channels", "slack.ts"), "utf8");
assert.match(slack, /\.onDirectMessage\(/u);
assert.doesNotMatch(slack, /\.onNewMention\(|\.onSubscribedMessage\(/u);

console.log("Baseline structure is intentionally small.");

function walk(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...walk(join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}
