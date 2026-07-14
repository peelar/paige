import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

test("workflow model", async () => {
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workflows = await readFile(join(repositoryRoot, "docs/internal/WORKFLOWS.md"), "utf8");
const repositoryModel = await readFile(join(repositoryRoot, "docs/internal/REPOSITORY_MODEL.md"), "utf8");
const manifest = await readFile(join(repositoryRoot, "docs/internal/MANIFEST.md"), "utf8");
const roadmap = await readFile(join(repositoryRoot, "docs/internal/ROADMAP.md"), "utf8");

for (const heading of [
  "Mentioned In Context",
  "Periodic Scan",
  "Initiative Or Project Participation",
  "Release Readiness",
  "Current-Docs Verification",
  "Patch Handoff",
]) {
  assert.match(workflows, new RegExp(`### ${heading}`));
}

for (const boundary of [
  "Signal intake",
  "Decision and triage",
  "Current-docs verification",
  "Draft authoring",
  "Writeback",
]) {
  assert.match(workflows, new RegExp(`\\| ${boundary} \\|`));
}

for (const tool of [
  "create_docs_signal",
  "scan_watched_repositories",
  "verify_docs_signal_current_docs",
  "authoring_workspace",
  "publish_working_repository_pr",
]) {
  assert.equal(workflows.includes(`\`${tool}\``), true);
}

assert.equal(workflows.includes("run_docs_maintenance_scenario"), false);
assert.match(workflows, /composable repository reads and named checks/);
assert.match(workflows, /Draft PR publishing waits for explicit approval/);
assert.match(workflows, /No sandbox verification runs yet/);
assert.match(workflows, /Slack Mention With Source Evidence/);
assert.match(workflows, /Linear Issue Without Source Evidence/);
assert.match(manifest, /docs\/internal\/WORKFLOWS\.md/);
assert.match(roadmap, /docs\/internal\/WORKFLOWS\.md/);
assert.match(repositoryModel, /Docs Impact Decision Model/);

console.log("Workflow model checks passed.");
});
