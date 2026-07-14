import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentRoot = join(repositoryRoot, "apps", "agent");
const inventoryPath = join(
  repositoryRoot,
  "docs",
  "internal",
  "CAPABILITIES.md",
);

const info = spawnSync("pnpm", ["exec", "eve", "info", "--json"], {
  cwd: agentRoot,
  encoding: "utf8",
  env: process.env,
});

if (info.status !== 0) {
  throw new Error(
    `Eve capability discovery failed.\n${info.stdout}${info.stderr}`.trim(),
  );
}

const manifest = JSON.parse(
  readFileSync(
    join(agentRoot, ".eve", "compile", "compiled-agent-manifest.json"),
    "utf8",
  ),
);
const inventory = readFileSync(inventoryPath, "utf8");

const stableFamilies = parseTable(inventory, "Stable Capability Families", 4);
assert.deepEqual(
  stableFamilies.map((row) => codeValue(row[0])),
  [
    "knowledge.read",
    "repository.read",
    "docs_work.manage",
    "draft.edit",
    "follow_up.schedule",
    "provider.deliver",
    "publication.publish",
  ],
  "The accepted stable capability-family identifiers changed without updating the architecture decision.",
);
assert.equal(
  stableFamilies.find((row) => codeValue(row[0]) === "publication.publish")?.[2],
  "Never",
  "publication.publish must never be grantable by a watch.",
);
assert.match(
  inventory,
  /Ignore and abstain are outcomes, not capabilities\./u,
  "Ignore and abstain must remain outcomes rather than capabilities.",
);

const authoredRows = parseTable(inventory, "Current Authored Tool Migration", 8);
const authoredNames = authoredRows.map((row) => codeValue(row[0])).toSorted();
const manifestToolNames = manifest.tools
  .map((tool) => tool.name)
  .toSorted();
assert.deepEqual(
  authoredNames,
  manifestToolNames,
  "The authored Eve tool surface and capability migration inventory diverged.",
);
assert.equal(
  new Set(authoredNames).size,
  authoredNames.length,
  "The authored capability migration inventory contains duplicate tools.",
);
assert.ok(
  authoredNames.includes("working_repository"),
  "The canonical working_repository capability must be present in the compiled manifest.",
);
for (const docsWorkTool of ["docs_work_read", "docs_work_manage"]) {
  assert.ok(
    authoredNames.includes(docsWorkTool),
    `The canonical ${docsWorkTool} capability must be present in the compiled manifest.`,
  );
}
for (const removedRepositoryTool of [
  "prepare_configured_working_repository",
  "prepare_working_repository",
  "repo_export_diff",
  "repo_read_file",
  "repo_run_checks",
  "repo_search",
]) {
  assert.equal(
    authoredNames.includes(removedRepositoryTool),
    false,
    `${removedRepositoryTool} must not remain model-facing after working_repository replaces it.`,
  );
}
for (const removedMutationTool of [
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
]) {
  assert.equal(
    authoredNames.includes(removedMutationTool),
    false,
    `${removedMutationTool} must not remain model-facing after authoring_workspace convergence.`,
  );
}
assert.deepEqual(
  manifest.dynamicTools,
  [],
  "Dynamic tools need an explicit inventory and resolver-matrix check before they can ship.",
);
assert.deepEqual(
  manifest.connections,
  [],
  "Authored connections and their discovered tools need an explicit capability inventory before they can ship.",
);
assert.deepEqual(
  manifest.subagents,
  [],
  "Declared subagents need an explicit capability inventory before they can ship.",
);
assert.deepEqual(
  manifest.remoteAgents,
  [],
  "Remote agents need an explicit capability inventory before they can ship.",
);
assert.equal(
  manifest.workflowEnabled,
  false,
  "The experimental Workflow tool needs an explicit capability decision before it can ship.",
);

const requireFromAgent = createRequire(join(agentRoot, "package.json"));
const eveRoot = dirname(requireFromAgent.resolve("eve/package.json"));
const defaultHarness = readFileSync(
  join(eveRoot, "docs", "concepts", "default-harness.md"),
  "utf8",
);
const frameworkNames = parseTable(defaultHarness, "Built-in tools", 3)
  .flatMap((row) =>
    [...row[0].matchAll(/`([^`]+)`/gu)].map((match) => match[1]),
  )
  .toSorted();
const frameworkRows = parseTable(inventory, "Framework Tool Inventory", 7);
assert.deepEqual(
  frameworkRows.map((row) => codeValue(row[0])).toSorted(),
  frameworkNames,
  "The installed Eve framework tool surface and Paige inventory diverged.",
);

const disabledFrameworkRows = frameworkRows
  .filter((row) => row[1] === "Disabled")
  .map((row) => codeValue(row[0]))
  .toSorted();
assert.deepEqual(
  disabledFrameworkRows,
  [...manifest.disabledFrameworkTools].toSorted(),
  "The documented and compiled disabled framework tools diverged.",
);
assert.deepEqual(
  disabledFrameworkRows,
  ["bash", "glob", "grep", "read_file", "write_file"],
  "Raw shell and unrestricted filesystem tools must remain disabled.",
);

const connectionSearch = frameworkRows.find(
  (row) => codeValue(row[0]) === "connection_search",
);
assert.equal(
  connectionSearch?.[1],
  "Unavailable without connections",
  "connection_search status must reflect the compiled connection surface.",
);
const loadSkill = frameworkRows.find(
  (row) => codeValue(row[0]) === "load_skill",
);
assert.equal(
  manifest.skills.length > 0 ? loadSkill?.[1] : "no-skills",
  manifest.skills.length > 0 ? "Active" : "no-skills",
  "load_skill status must reflect the compiled skill surface.",
);

const plannedRows = parseTable(inventory, "Planned Watch Surface Migration", 6);
for (const issue of ["#58", "#59", "#60", "#61", "#62"]) {
  assert.ok(
    plannedRows.some((row) => row[0].includes(issue)),
    `The planned watch migration is missing ${issue}.`,
  );
}
assert.match(inventory, /#64-#69/u);
assert.match(inventory, /#70-#75/u);

const publishTool = readFileSync(
  join(
    agentRoot,
    "agent",
    "tools",
    "publish_working_repository_pr.ts",
  ),
  "utf8",
);
assert.match(
  publishTool,
  /approval:\s*always\(\)/u,
  "The publication tool must require explicit approval on every call.",
);

console.log(
  `Capability inventory checks passed for ${manifestToolNames.length} authored and ${frameworkNames.length} framework tools.`,
);

function parseTable(markdown, heading, columnCount) {
  const headingIndex = markdown.indexOf(`## ${heading}`);
  assert.notEqual(headingIndex, -1, `Missing section: ${heading}.`);
  const section = markdown.slice(headingIndex + heading.length + 3);
  const nextHeading = section.search(/^## /mu);
  const body = nextHeading === -1 ? section : section.slice(0, nextHeading);
  const rows = body
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((row) => !row.every((cell) => /^-+$/u.test(cell)))
    .slice(1);

  assert.ok(rows.length > 0, `Section ${heading} has no table rows.`);
  for (const row of rows) {
    assert.equal(
      row.length,
      columnCount,
      `Section ${heading} has a row with ${row.length} columns instead of ${columnCount}: ${row.join(" | ")}`,
    );
    assert.ok(
      row.every((cell) => cell.length > 0),
      `Section ${heading} has an empty cell: ${row.join(" | ")}`,
    );
  }
  return rows;
}

function codeValue(cell) {
  const match = cell.match(/^`([^`]+)`$/u);
  return match?.[1] ?? cell;
}
