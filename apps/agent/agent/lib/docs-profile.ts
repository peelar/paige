import { createHash } from "node:crypto";

import {
  invalidateDocsProfile,
  readReusableDocsProfile,
  saveDocsProfile,
  type CachedDocsProfile,
  type DocsProfile,
} from "@docs-agent/control-plane/agent";
import type { ToolContext } from "eve/tools";

import type { ResolvedWorkingDocumentationRepository } from "./repository-contract.js";
import type { DocsMaintenanceWorkflowResult } from "./repository-workflow-contract.js";

export type DocsProfileRefreshReason = "maintainer-correction" | "contradiction" | "manual-refresh";

export async function ensureDocsProfile(input: {
  ctx: ToolContext;
  repository: ResolvedWorkingDocumentationRepository;
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  refreshReason?: DocsProfileRefreshReason;
}): Promise<CachedDocsProfile> {
  const inspection = await inspectProfileSources(input.ctx, input.repository);
  const identity = {
    repositoryUrl: input.repository.source.url,
    requestedRef: input.repository.ref,
    docsRoot: input.repository.docsRoot,
    resolvedRevision: input.materialization.resolvedCommit ?? input.repository.ref,
    sourceFingerprint: inspection.fingerprint,
  };

  if (input.refreshReason !== undefined) {
    await invalidateDocsProfile({
      repositoryUrl: identity.repositoryUrl,
      requestedRef: identity.requestedRef,
      docsRoot: identity.docsRoot,
      reason: input.refreshReason,
    });
  }

  const cached = await readReusableDocsProfile(identity);
  if (cached.profile !== null) return cached.profile;

  return saveDocsProfile({ identity, profile: buildProfile(inspection.files) });
}

export async function loadTaskExamples(input: {
  ctx: ToolContext;
  repository: ResolvedWorkingDocumentationRepository;
  paths: string[];
}): Promise<Array<{ path: string; excerpt: string }>> {
  const sandbox = await input.ctx.getSandbox();
  const examples: Array<{ path: string; excerpt: string }> = [];
  for (const path of [...new Set(input.paths)].slice(0, 5)) {
    if (path.startsWith("/") || path.split("/").includes("..")) continue;
    const absolute = `${input.repository.sandboxPath}/${path}`;
    const content = await sandbox.readTextFile({ path: absolute, abortSignal: input.ctx.abortSignal });
    if (content !== null) examples.push({ path, excerpt: content.slice(0, 4_000) });
  }
  return examples;
}

async function inspectProfileSources(ctx: ToolContext, repository: ResolvedWorkingDocumentationRepository) {
  const sandbox = await ctx.getSandbox();
  const listing = await sandbox.run({
    command: "find . -maxdepth 4 -type f | sed 's#^./##' | sort | head -200",
    workingDirectory: repository.sandboxPath,
    abortSignal: ctx.abortSignal,
  });
  if (listing.exitCode !== 0) throw new Error(`Docs profile source discovery failed: ${listing.stderr}`);

  const all = listing.stdout.split("\n").filter(Boolean);
  const explicit = all.filter((path) => /(^|\/)(AGENTS\.md|CONTRIBUTING\.md|STYLE[^/]*\.md|README\.md|package\.json|sidebars\.[^/]+|docusaurus\.config\.[^/]+)$/i.test(path));
  const representative = all.filter((path) => path.startsWith(`${repository.docsRoot === "." ? "" : `${repository.docsRoot}/`}`) && /\.mdx?$/.test(path));
  const selected = [...new Set([...explicit, ...representative.slice(0, 6)])].slice(0, 16);
  if (selected.length === 0) throw new Error("Docs profile generation found no instruction, configuration, or representative documentation files.");

  const files: Array<{ path: string; content: string }> = [];
  for (const path of selected) {
    const content = await sandbox.readTextFile({ path: `${repository.sandboxPath}/${path}`, abortSignal: ctx.abortSignal });
    if (content !== null) files.push({ path, content: content.slice(0, 12_000) });
  }
  const fingerprint = createHash("sha256").update(files.map(({ path, content }) => `${path}\0${content}`).join("\0")).digest("hex");
  return { files, fingerprint };
}

function buildProfile(files: Array<{ path: string; content: string }>): DocsProfile {
  const sources = files.map(({ path }) => path);
  const markdown = files.filter(({ path }) => /\.mdx?$/.test(path));
  const headings = markdown.flatMap(({ path, content }) => [...content.matchAll(/^#{1,3}\s+(.+)$/gm)].slice(0, 8).map((match) => ({ path, value: match[1]!.trim() })));
  const components = [...new Set(markdown.flatMap(({ content }) => [...content.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1]!)))];
  const rules = files.filter(({ path }) => /AGENTS|CONTRIBUTING|STYLE/i.test(path)).flatMap(({ path, content }) => content.split("\n").filter((line) => /\b(must|should|prefer|avoid|do not)\b/i.test(line)).slice(0, 8).map((line) => observation(line.replace(/^[-*]\s*/, "").trim(), "high", [path])));
  const packageFile = files.find(({ path }) => path.endsWith("package.json"));
  const validation = packageFile === undefined ? [] : validationScripts(packageFile);
  const audienceValues = inferAudiences(files);

  return {
    audiences: audienceValues.map((value) => observation(value, "medium", sources.slice(0, 3))),
    navigation: headings.slice(0, 8).map(({ path, value }) => observation(value, "medium", [path])),
    pageTypes: [...new Set(markdown.map(({ path }) => pageType(path)))].map((value) => observation(value, "medium", markdown.slice(0, 3).map(({ path }) => path))),
    styleRules: rules,
    terminology: headings.slice(0, 8).map(({ path, value }) => observation(`Use repository heading terminology: ${value}`, "low", [path])),
    componentsAndExamples: components.slice(0, 12).map((value) => observation(`<${value}> is reused in representative pages.`, "medium", markdown.filter(({ content }) => content.includes(`<${value}`)).map(({ path }) => path))),
    validation,
    inspectedSources: sources,
  };
}

function validationScripts(file: { path: string; content: string }) {
  try {
    const scripts = (JSON.parse(file.content) as { scripts?: Record<string, string> }).scripts ?? {};
    return Object.entries(scripts).filter(([name]) => /build|preview|lint|link|check|test/.test(name)).slice(0, 10).map(([name, command]) => observation(`${name}: ${command}`, "high", [file.path]));
  } catch { return []; }
}
function inferAudiences(files: Array<{ path: string; content: string }>) { const text = files.map(({ content }) => content).join("\n").toLowerCase(); return [text.includes("developer") ? "Developers and app builders" : "Documentation readers", ...(text.includes("merchant") ? ["Commerce operators and merchants"] : [])]; }
function pageType(path: string) { if (/tutorial|quickstart|getting-started/i.test(path)) return "Tutorial or getting-started guide"; if (/reference|api/i.test(path)) return "Reference documentation"; if (/how-to|guide/i.test(path)) return "Task-oriented guide"; return "Conceptual documentation"; }
function observation(value: string, confidence: "high" | "medium" | "low", sources: string[]) { return { value, confidence, sources: sources.length ? sources : ["repository inspection"] } as const; }
