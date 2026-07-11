import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentRoot = join(repositoryRoot, "apps", "agent");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

for (const script of ["dev", "build", "typecheck", "test", "check"]) {
  if (!packageJson.scripts?.[script]?.includes("turbo run")) {
    throw new Error(`Root script ${script} must run through Turborepo.`);
  }
}

const workspaceList = JSON.parse(
  run("workspace discovery", ["--recursive", "list", "--depth", "-1", "--json"]),
);
const workspaceNames = new Set(workspaceList.map((workspace) => workspace.name));

for (const name of ["docs-agent-workspace", "docs-agent", "@docs-agent/web"]) {
  if (!workspaceNames.has(name)) {
    throw new Error(`pnpm did not discover workspace package ${name}.`);
  }
}

run("Eve discovery", ["--filter", "docs-agent", "exec", "eve", "info"]);

const discoveryManifestPath = join(
  agentRoot,
  ".eve",
  "discovery",
  "agent-discovery-manifest.json",
);
const discoveryManifest = JSON.parse(readFileSync(discoveryManifestPath, "utf8"));

if (discoveryManifest.agentId !== "docs-agent") {
  throw new Error(`Eve discovered unexpected agent ${discoveryManifest.agentId}.`);
}

if (resolve(discoveryManifest.appRoot) !== agentRoot) {
  throw new Error(`Eve discovered app root ${discoveryManifest.appRoot}, expected ${agentRoot}.`);
}

if (discoveryManifest.diagnosticsSummary?.errors !== 0) {
  throw new Error("Eve discovery reported errors after the workspace move.");
}

if (!Array.isArray(discoveryManifest.tools) || discoveryManifest.tools.length === 0) {
  throw new Error("Eve did not discover the agent tools from apps/agent.");
}

const evalList = run("eval discovery", ["eval", "--list"]);
for (const evalId of [
  "docs-signal-workflows",
  "identity",
  "saleor-docs-user-tests",
  "watched-repositories",
  "workspace-memory",
]) {
  if (!evalList.includes(evalId)) {
    throw new Error(`Eve did not list eval ${evalId} from apps/agent/evals.`);
  }
}

const migrationRoot = mkdtempSync(join(tmpdir(), "docs-agent-monorepo-smoke-"));
const databaseUrl = `file:${join(migrationRoot, "docs-agent.sqlite")}`;

try {
  run("isolated database migration", ["db:migrate"], {
    DOCS_AGENT_DATABASE_URL: databaseUrl,
  });

  const tableList = run(
    "isolated database verification",
    [
      "--filter",
      "docs-agent",
      "exec",
      "node",
      "--input-type=module",
      "--eval",
      [
        'import { createClient } from "@libsql/client";',
        "const client = createClient({ url: process.env.DOCS_AGENT_DATABASE_URL });",
        'const result = await client.execute("SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name");',
        "console.log(result.rows.map((row) => row.name).join(\"\\n\"));",
        "client.close();",
      ].join(" "),
    ],
    { DOCS_AGENT_DATABASE_URL: databaseUrl },
  );

  for (const table of ["__drizzle_migrations", "docs_signals", "workspace_setup"]) {
    if (!tableList.split("\n").includes(table)) {
      throw new Error(`Isolated migration did not create ${table}.`);
    }
  }
} finally {
  rmSync(migrationRoot, { recursive: true, force: true });
}

console.log("Monorepo smoke checks passed.");

function run(label, args, extraEnv = {}) {
  const result = spawnSync("pnpm", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });

  if (result.status !== 0) {
    throw new Error(
      `${label} failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    );
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
