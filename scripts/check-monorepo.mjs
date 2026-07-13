import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentRoot = join(repositoryRoot, "apps", "agent");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const agentPackageJson = JSON.parse(readFileSync(join(agentRoot, "package.json"), "utf8"));
const webPackageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "apps", "web", "package.json"), "utf8"),
);
const turboJson = JSON.parse(readFileSync(join(repositoryRoot, "turbo.json"), "utf8"));

const workspaceSetupSkillPath = join(
  repositoryRoot,
  ".agents",
  "skills",
  "setup",
  "SKILL.md",
);
const workspaceSetupSkill = readFileSync(workspaceSetupSkillPath, "utf8");
if (!/^---\nname: setup\ndescription: .+\n---\n/u.test(workspaceSetupSkill)) {
  throw new Error("Workspace setup skill must have portable name and description frontmatter.");
}
for (const expected of [
  "Speak as Paige",
  "pnpm paige status",
  "pnpm paige configure",
  "humanRequired: true",
  "vercel connect update <slack-uid>",
  "./assets/paige/paige-magpie-master.png",
  "non-empty `icon`",
]) {
  if (!workspaceSetupSkill.includes(expected)) {
    throw new Error(`Workspace setup skill is missing: ${expected}`);
  }
}
if (existsSync(join(agentRoot, "agent", "skills", "setup"))) {
  throw new Error("Setup belongs to the cloned workspace, not Paige's Eve runtime skills.");
}
if (!packageJson.scripts?.paige?.includes("@docs-agent/control-plane")) {
  throw new Error("Root Paige command must use the shared control-plane setup service.");
}

const controlPlaneRoot = join(repositoryRoot, "packages", "control-plane");
const typescriptSourceRoots = [
  join(controlPlaneRoot, "src"),
  join(controlPlaneRoot, "scripts"),
  join(repositoryRoot, "apps", "agent", "agent"),
  join(repositoryRoot, "apps", "agent", "evals"),
  join(repositoryRoot, "apps", "agent", "scripts"),
];

for (const filePath of walkFiles(controlPlaneRoot)) {
  if (filePath.endsWith(".js")) {
    throw new Error(`Control-plane must remain TypeScript-only: ${filePath}`);
  }
}

const relativeJavaScriptImport =
  /(?:from\s+|import\s*\(\s*|import\s+)["']\.{1,2}\/[^"']+\.js["']/u;
for (const sourceRoot of typescriptSourceRoots) {
  for (const filePath of walkFiles(sourceRoot)) {
    if (!/\.tsx?$/u.test(filePath)) continue;
    if (relativeJavaScriptImport.test(readFileSync(filePath, "utf8"))) {
      throw new Error(`TypeScript source must not use a relative .js import: ${filePath}`);
    }
  }
}

for (const script of ["dev", "build", "typecheck", "test", "check"]) {
  if (!packageJson.scripts?.[script]?.includes("turbo run")) {
    throw new Error(`Root script ${script} must run through Turborepo.`);
  }
}

if (packageJson.scripts?.dev !== "pnpm dev:proxy && turbo run dev") {
  throw new Error("Root pnpm dev must start Portless and every workspace development task.");
}
if (packageJson.scripts?.["dev:proxy"] !== "portless proxy start --no-tls --port 1355") {
  throw new Error("Local development must use the shared Portless proxy on port 1355.");
}
if (
  !packageJson.scripts?.["dev:agent"]?.includes("pnpm dev:proxy") ||
  !packageJson.scripts?.["dev:agent"]?.includes("--filter=docs-agent")
) {
  throw new Error("The focused agent development command must filter to docs-agent.");
}
if (
  !packageJson.scripts?.["dev:web"]?.includes("pnpm dev:proxy") ||
  !packageJson.scripts?.["dev:web"]?.includes("--filter=@docs-agent/web")
) {
  throw new Error("The focused web development command must filter to @docs-agent/web.");
}
if (packageJson.devDependencies?.portless !== "0.15.1") {
  throw new Error("The workspace must pin the Portless development proxy version.");
}
if (!agentPackageJson.scripts?.dev?.includes("portless agent.paige eve dev")) {
  throw new Error("The Eve development server must use the agent.paige Portless route.");
}
if (
  !webPackageJson.scripts?.dev?.includes("portless paige next dev") ||
  !webPackageJson.scripts?.dev?.includes("portless get agent.paige")
) {
  throw new Error("The operator app must use Portless and address Eve through its named route.");
}

const agentBuildTask = turboJson.tasks?.["docs-agent#build"];
const agentBuildEnvironment = new Set(agentBuildTask?.env ?? []);

for (const variable of [
  "DOCS_AGENT_DATABASE_AUTH_TOKEN",
  "DOCS_AGENT_DATABASE_URL",
  "DOCS_AGENT_LINEAR_CONNECTOR",
  "DOCS_AGENT_SLACK_CONNECTOR",
  "EVE_GATEWAY_MODEL",
]) {
  if (!agentBuildEnvironment.has(variable)) {
    throw new Error(`Agent build must receive ${variable} through Turborepo.`);
  }
}

if (!agentBuildTask?.outputs?.includes(".vercel/output/**")) {
  throw new Error("Agent build must cache its Vercel Build Output API artifacts.");
}

const workspaceList = JSON.parse(
  run("workspace discovery", ["--recursive", "list", "--depth", "-1", "--json"]),
);
const workspaceNames = new Set(workspaceList.map((workspace) => workspace.name));

for (const name of [
  "docs-agent-workspace",
  "docs-agent",
  "@docs-agent/control-plane",
  "@docs-agent/web",
]) {
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
      "@docs-agent/control-plane",
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

  for (const table of [
    "__drizzle_migrations",
    "docs_profiles",
    "docs_signals",
    "workspace_knowledge_events",
    "workspace_knowledge_records",
    "workspace_knowledge_sources",
    "workspace_setup",
  ]) {
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

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      [".eve", ".next", ".output", ".turbo", "node_modules", "test-results"].includes(entry.name)
    ) {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
