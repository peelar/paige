import { z } from "zod";

import { legacyImpactDecisionSchema } from "./docs-impact-decision.js";
import { repositoryActionRecordSchema } from "./repository-materialization.js";
import type { RepositoryActionRecord } from "./repository-materialization.js";
import type { ResolvedRepositoryInput } from "./repository-contract.js";

export const repositoryCheckNameSchema = z.enum([
  "install",
  "build",
  "diff-check",
  "diff-quiet",
  "status",
]);

export const impactDecisionSchema = legacyImpactDecisionSchema;

export const repositoryCheckResultSchema = z.object({
  name: repositoryCheckNameSchema,
  command: z.string(),
  exitCode: z.number(),
  status: z.enum(["passed", "failed"]),
  stdout: z.string(),
  stderr: z.string(),
});

export const repositoryMaterializationSchema = z.object({
  repositoryUrl: z.string(),
  requestedRef: z.string(),
  resolvedCommit: z.string().optional(),
  docsRoot: z.string(),
  sandboxPath: z.string(),
  status: z.enum(["materialized", "failed"]),
});

export const documentationImpactReportSchema = z.object({
  decision: impactDecisionSchema,
  affectedPages: z.array(z.string()),
  proposedAction: z.string(),
  evidence: z.array(z.string()),
  consideredPages: z.array(z.string()),
  uncertainty: z.array(z.string()),
  patchSummary: z.string(),
  checks: z.array(repositoryCheckResultSchema),
});

export const docsMaintenanceWorkflowResultSchema = z.object({
  ok: z.boolean(),
  scenarioKind: z.enum([
    "private-metadata-filtering",
    "sandbox-rate-limit-false-alarm",
    "unknown",
  ]),
  materialization: repositoryMaterializationSchema,
  report: documentationImpactReportSchema,
  changedFiles: z.array(z.string()),
  diff: z.string(),
  noDiff: z.boolean(),
  actionProvenance: z.array(repositoryActionRecordSchema),
  rawSandboxToolsPolicy: z.string(),
});

export const runDocsMaintenanceScenarioInputSchema = z.object({
  scenarioText: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The full user scenario and attached context. The working documentation repository must already be configured through configure_working_repository.",
    ),
});

export type RepositoryCheckName = z.infer<typeof repositoryCheckNameSchema>;
export type RepositoryCheckResult = z.infer<typeof repositoryCheckResultSchema>;
export type DocumentationImpactReport = z.infer<typeof documentationImpactReportSchema>;
export type DocsMaintenanceWorkflowResult = z.infer<typeof docsMaintenanceWorkflowResultSchema>;
export type RunDocsMaintenanceScenarioInput = z.infer<
  typeof runDocsMaintenanceScenarioInputSchema
>;
export type ScenarioKind = DocsMaintenanceWorkflowResult["scenarioKind"];

export interface WorkflowState {
  repositoryInput: ResolvedRepositoryInput;
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  actionProvenance: RepositoryActionRecord[];
  lastResult?: DocsMaintenanceWorkflowResult;
}
