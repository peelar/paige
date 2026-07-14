import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

test("instruction boundaries", async () => {
const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const agentRoot = join(appRoot, "agent");
const instructionsRoot = join(agentRoot, "instructions");
const skillsRoot = join(agentRoot, "skills");

await assert.rejects(access(join(agentRoot, "instructions.md")));

const identity = await readFile(join(instructionsRoot, "identity.md"), "utf8");
assert.equal(identity, `# Identity

You are Paige, a knowledge and documentation agent for software teams.

Be warm with people and strict with claims.
Be curious, tactful, and quietly opinionated.
Advocate for readers.
Keep ordinary conversation natural, proportional, and free of decorative emoji.
Treat greetings, bare mentions, and incomplete thoughts as invitations to continue.
For greetings and bare mentions, ask one short question without introducing yourself or listing capabilities.
Use plain language when provider identifiers or internal workflow terms do not help the reader.
Be concise in conversation. Use descriptive Markdown links when inspected source evidence has a URL.
Do not force jokes, catchphrases, or references to your name or mascot.
`);
assert.doesNotMatch(identity, /documentation impact report|Slack|Linear|setup mode|authoring_workspace|publish_working_repository_pr/);

const principles = await readFile(join(instructionsRoot, "principles.md"), "utf8");
assert.match(principles, /Ground claims in current, attributable evidence/);
assert.match(principles, /proper trust classes/);
assert.match(principles, /Documentation is the only mutable product domain/);
assert.match(principles, /Fail visibly/);
assert.match(principles, /explicit approval/);
assert.doesNotMatch(
  principles,
  /Slack|Linear|memory_|setup state|repo_|run_docs_|capture_|verify_docs_|content_plan|authoring_workspace/,
);
assert.equal(wordCount(identity) + wordCount(principles) < 220, true);

for (const dynamicInstruction of ["behavior.ts", "memory.ts", "setup.ts"]) {
  const source = await readFile(join(instructionsRoot, dynamicInstruction), "utf8");
  assert.match(source, /defineDynamic/);
  assert.match(source, /"turn\.started"/);
}

const maintenance = await readFile(
  join(skillsRoot, "docs-maintenance.ts"),
  "utf8",
);
assert.match(maintenance, /defineDynamic/);
assert.match(maintenance, /"turn\.started"/);
assert.match(maintenance, /`working_repository` list, search, and line-range read modes/);
assert.match(maintenance, /`run_validators` is atomic read-only inspection/);
assert.doesNotMatch(maintenance, /run_docs_maintenance_scenario/);
assert.match(maintenance, /clean diff/);
assert.match(maintenance, /explicit approval/);
assert.doesNotMatch(maintenance, /documentation-impact or working-repository workflow/);

const knowledge = await readFile(
  join(skillsRoot, "workspace-knowledge.ts"),
  "utf8",
);
assert.match(knowledge, /defineDynamic/);
assert.match(knowledge, /"turn\.started"/);
assert.match(knowledge, /sourced answer, an\s+explicit abstention, or a natural-language recommendation/);
assert.match(knowledge, /Do not cite a configured source that was not inspected/);
assert.match(knowledge, /Provider conversation and workspace memory.*never independent proof/s);
assert.match(knowledge, /does not by itself justify\s+`docs_work_manage`/);
assert.match(knowledge, /proportional general\s+answer/);
assert.match(knowledge, /source ids, refs or resolved revisions, paths or URLs/);
assert.doesNotMatch(knowledge, /run_workspace_knowledge|answer_workspace_question/);

const intake = await readFile(
  join(skillsRoot, "docs-signal-intake.ts"),
  "utf8",
);
assert.match(intake, /defineDynamic/);
assert.match(intake, /"turn\.started"/);
assert.match(intake, /provider-neutral signal/);
assert.match(intake, /source evidence is missing/);
assert.match(intake, /`docs_work_manage`/);
assert.match(intake, /Do not patch during intake/);

const watched = await readFile(
  join(skillsRoot, "watched-repository-scan.ts"),
  "utf8",
);
assert.match(watched, /defineDynamic/);
assert.match(watched, /"turn\.started"/);
assert.match(watched, /read-only source evidence/);
assert.match(watched, /Do not write during the watched\s+repository scan/);
assert.match(watched, /sourced answer, explicit abstention, recommendation, or documentation decision/);
assert.match(watched, /`knowledge\.read` and `repository\.read` capabilities/);
assert.doesNotMatch(watched, /scan_watched_repositories|Start with a documentation impact report/);

const watchExecution = await readFile(
  join(skillsRoot, "watch-execution.ts"),
  "utf8",
);
assert.match(watchExecution, /defineDynamic/);
assert.match(watchExecution, /"turn\.started"/);
assert.match(watchExecution, /read that exact document.*before evaluating/s);
assert.match(watchExecution, /separate evidence, hypotheses, and open questions/);
assert.match(watchExecution, /revise superseded conclusions in place/);
assert.match(watchExecution, /Leave an existing continuity document unchanged/);
assert.match(watchExecution, /Never copy raw provider content/);
assert.match(watchExecution, /Publication is never available to a watch/);

const obsoleteWorkflowNames = [
  "run_docs_maintenance_scenario",
  "prepare_configured_working_repository",
  "prepare_working_repository",
  "repo_export_diff",
  "repo_read_file",
  "repo_run_checks",
  "repo_search",
  "prepare_docs_signal_patch",
  "repo_replace_text",
  "content_plan",
  "create_docs_signal",
  "editorial_recommendation",
  "get_docs_signal",
  "list_docs_signals",
  "owned_docs_work",
  "update_docs_signal_lifecycle",
  "verify_docs_signal_current_docs",
];
const modelVisibleSources = await Promise.all([
  ...(await readdir(instructionsRoot)).map((name) => readFile(join(instructionsRoot, name), "utf8")),
  ...(await readdir(skillsRoot)).map((name) => readFile(join(skillsRoot, name), "utf8")),
]);
for (const obsolete of obsoleteWorkflowNames) {
  assert.equal(
    modelVisibleSources.some((source) => source.includes(obsolete)),
    false,
    `${obsolete} must not remain in active instructions or skills`,
  );
}

console.log("Instruction boundary checks passed.");

function wordCount(value: string) {
  return value.trim().split(/\s+/u).length;
}
});
