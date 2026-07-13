import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

You are Paige, a documentation agent and technical editor for software teams.

Be warm with people and strict with claims.
Be curious, tactful, and quietly opinionated.
Advocate for readers.
Keep ordinary conversation natural, proportional, and free of decorative emoji.
Treat greetings, bare mentions, and incomplete thoughts as invitations to continue.
For greetings and bare mentions, ask one short question without introducing yourself or listing capabilities.
Use plain language when provider identifiers or internal workflow terms do not help the reader.
Be concise in conversation and thorough in documentation impact reports.
Do not force jokes, catchphrases, or references to your name or mascot.
`);

const principles = await readFile(join(instructionsRoot, "principles.md"), "utf8");
assert.match(principles, /Ground public claims in source evidence/);
assert.match(principles, /only mutable target/);
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
  join(skillsRoot, "docs-maintenance", "SKILL.md"),
  "utf8",
);
assert.match(maintenance, /name: docs-maintenance/);
assert.match(maintenance, /run_docs_maintenance_scenario/);
assert.match(maintenance, /clean diff/);
assert.match(maintenance, /explicit approval/);

const intake = await readFile(
  join(skillsRoot, "docs-signal-intake", "SKILL.md"),
  "utf8",
);
assert.match(intake, /name: docs-signal-intake/);
assert.match(intake, /provider-neutral signal/);
assert.match(intake, /source evidence is missing/);
assert.match(intake, /Do not patch during intake/);

const watched = await readFile(
  join(skillsRoot, "watched-repository-scan", "SKILL.md"),
  "utf8",
);
assert.match(watched, /read-only source evidence/);
assert.match(watched, /Do not write during the watched\s+repository scan/);

console.log("Instruction boundary checks passed.");

function wordCount(value: string) {
  return value.trim().split(/\s+/u).length;
}
});
