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
  "Documentation work",
  "Decision and triage",
  "Current-docs verification",
  "Draft authoring",
  "Writeback",
]) {
  assert.match(workflows, new RegExp(`\\| ${boundary} \\|`));
}

for (const tool of [
  "docs_work_manage",
  "docs_work_read",
  "scan_watched_repositories",
  "authoring_workspace",
  "publish_working_repository_pr",
]) {
  assert.equal(workflows.includes(`\`${tool}\``), true);
}
for (const removed of [
  "create_docs_signal",
  "get_docs_signal",
  "list_docs_signals",
  "update_docs_signal_lifecycle",
  "owned_docs_work",
  "editorial_recommendation",
  "content_plan",
  "verify_docs_signal_current_docs",
]) {
  assert.equal(workflows.includes(`\`${removed}\``), false);
}

assert.equal(workflows.includes("run_docs_maintenance_scenario"), false);
assert.match(workflows, /repository reads; bounded `working_repository` modes serve direct investigations/);
assert.match(workflows, /Draft PR publishing waits for explicit approval/);
assert.match(workflows, /No sandbox verification runs yet/);
assert.match(workflows, /Slack Mention With Source Evidence/);
assert.match(workflows, /Linear Issue Without Source Evidence/);
assert.match(manifest, /docs\/internal\/WORKFLOWS\.md/);
assert.match(roadmap, /docs\/internal\/WORKFLOWS\.md/);
assert.match(repositoryModel, /Docs Impact Decision Model/);

console.log("Workflow model checks passed.");
});
