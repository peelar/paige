import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workflows = await readFile(join(repositoryRoot, "docs/WORKFLOWS.md"), "utf8");
const repositoryModel = await readFile(join(repositoryRoot, "docs/REPOSITORY_MODEL.md"), "utf8");
const manifest = await readFile(join(repositoryRoot, "docs/MANIFEST.md"), "utf8");
const roadmap = await readFile(join(repositoryRoot, "docs/ROADMAP.md"), "utf8");

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
  "Patch preparation",
  "Writeback",
]) {
  assert.match(workflows, new RegExp(`\\| ${boundary} \\|`));
}

for (const tool of [
  "create_docs_signal",
  "scan_watched_repositories",
  "run_docs_maintenance_scenario",
  "publish_working_repository_pr",
]) {
  assert.equal(workflows.includes(`\`${tool}\``), true);
}

assert.match(
  workflows,
  /run_docs_maintenance_scenario`: stays as the eval and scenario terminal\s+workflow for now/,
);
assert.match(workflows, /Draft PR publishing waits for explicit approval/);
assert.match(workflows, /No sandbox verification runs yet/);
assert.match(workflows, /Slack Mention With Source Evidence/);
assert.match(workflows, /Linear Issue Without Source Evidence/);
assert.match(manifest, /docs\/WORKFLOWS\.md/);
assert.match(roadmap, /docs\/WORKFLOWS\.md/);
assert.match(repositoryModel, /Docs Impact Decision Model/);

console.log("Workflow model checks passed.");
