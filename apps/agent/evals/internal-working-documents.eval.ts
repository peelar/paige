import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineEval } from "eve/evals";

const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
let controlPlaneTestingPromise:
  | Promise<typeof import("@docs-agent/control-plane/testing")>
  | undefined;
const { migrateDocsAgentDatabase } = await controlPlaneTesting();
const evalDataDir = mkdtempSync(join(tmpdir(), "paige-internal-document-evals-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(evalDataDir, "documents.sqlite")}`;
await migrateDocsAgentDatabase();

export default [
  defineEval({
    description: "A living internal summary replaces a superseded conclusion",
    tags: ["internal-documents", "living-summary", "skill-routing"],
    timeoutMs: 300_000,
    async test(t) {
      await t.send([
        "Keep a durable internal working note for this documentation investigation.",
        "The note is titled Release evidence review. It is a research-note using the living-summary editing profile and should be retained for 30 days.",
        "Earlier, the API behavior was only a hypothesis because public release evidence was missing. The official release now confirms the API behavior.",
        "Create one concise current summary that keeps the confirmed conclusion and removes the superseded hypothesis instead of preserving a chronological log.",
        "This is Paige's internal working state, not workspace memory or a public documentation draft.",
      ].join("\n"));

      t.succeeded();
      t.noFailedActions();
      t.loadedSkill("internal-working-document", { count: 1 });
      t.calledTool("internal_document", {
        input: (input) => matchesModeAndProfile(input, "create", "living-summary"),
        output: (output) =>
          matchesDocumentContent(output, "confirms", "living-summary") &&
          !documentContent(output).toLowerCase().includes("only a hypothesis"),
        count: 1,
      });
      assertNoOtherDurableMutationTools(t);
    },
  }),
  defineEval({
    description: "A chronological internal log preserves earlier entries",
    tags: ["internal-documents", "chronological-log", "skill-routing"],
    timeoutMs: 300_000,
    async test(t) {
      await t.send([
        "Keep a durable internal working log for documentation handoff decisions.",
        "The log is titled Migration guide decisions. It is a decision-log using the chronological-log editing profile and should be retained for 30 days.",
        "Record both meaningful dated entries in order:",
        "- 2026-07-14 - Chose the existing migration guide as the canonical surface.",
        "- 2026-07-15 - Confirmed that generated API reference pages remain untouched.",
        "This is Paige's internal working state, not workspace memory or a public documentation draft.",
      ].join("\n"));

      t.succeeded();
      t.noFailedActions();
      t.loadedSkill("internal-working-document", { count: 1 });
      t.calledTool("internal_document", {
        input: (input) => matchesModeAndProfile(input, "create", "chronological-log"),
        output: (output) => {
          const content = documentContent(output).toLowerCase();
          return content.includes("canonical surface") &&
            content.includes("generated api reference pages remain untouched");
        },
        count: 1,
      });
      assertNoOtherDurableMutationTools(t);
    },
  }),
];

function matchesModeAndProfile(
  input: unknown,
  mode: string,
  editingProfile: string,
): boolean {
  return isRecord(input) &&
    input.mode === mode &&
    input.editingProfile === editingProfile;
}

function matchesDocumentContent(
  output: unknown,
  expectedText: string,
  editingProfile: string,
): boolean {
  const value = unwrapModelOutput(output);
  return isRecord(value) &&
    isRecord(value.document) &&
    value.document.editingProfile === editingProfile &&
    String(value.document.content).toLowerCase().includes(expectedText.toLowerCase());
}

function documentContent(output: unknown): string {
  const value = unwrapModelOutput(output);
  return isRecord(value) && isRecord(value.document)
    ? String(value.document.content ?? "")
    : "";
}

function assertNoOtherDurableMutationTools(t: {
  notCalledTool(name: string): void;
}): void {
  for (const name of [
    "docs_work_manage",
    "docs_work_read",
    "memory_propose",
    "authoring_workspace",
    "publish_working_repository_pr",
  ]) {
    t.notCalledTool(name);
  }
}

function unwrapModelOutput(value: unknown): unknown {
  return isRecord(value) && value.type === "json" && "value" in value
    ? value.value
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function controlPlaneTesting() {
  controlPlaneTestingPromise ??= import(controlPlaneTestingModule);
  return controlPlaneTestingPromise;
}
