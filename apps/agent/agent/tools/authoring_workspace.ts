import { createHash } from "node:crypto";

import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import {
  abandonAuthoringDraft,
  abandonAuthoringDraftInputSchema,
  applyAuthoringDraft,
  applyAuthoringDraftInputSchema,
  inspectAuthoringDraft,
  prepareAuthoringDraft,
  prepareAuthoringDraftInputSchema,
} from "../lib/authoring-workspace";
import { docsSignalDetailSchema } from "../lib/docs-signals";
import { authoringDraftSchema, authoringOperationResultSchema, documentationImpactReportSchema } from "../lib/repository-workflow-contract";
import { requireSetupReady } from "../lib/setup-state";
import {
  loadOrMaterializeRepositoryWorkflowState,
  runWorkingRepositoryOperationSerially,
  workingRepositoryOperationKey,
} from "../lib/working-repository-lifecycle";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

const authoringWorkspaceModeInputSchema = z.discriminatedUnion("mode", [
  applyAuthoringDraftInputSchema.extend({ mode: z.literal("apply") }),
  z.object({ mode: z.literal("inspect"), paths: z.array(z.string().trim().min(1).max(500)).max(10).default([]) }),
  prepareAuthoringDraftInputSchema.extend({ mode: z.literal("prepare") }),
  abandonAuthoringDraftInputSchema.extend({ mode: z.literal("abandon") }),
]);

/**
 * Keep the provider-facing schema as one top-level object. Some model-provider
 * tool parsers infer argument types only from top-level `properties` and lose
 * array types hidden below a discriminated union's `oneOf` branches. The pipe
 * retains the existing mode-specific validation and defaults after the flat
 * object has rejected malformed provider input.
 */
export const authoringWorkspaceInputSchema = z.object({
  mode: z.enum(["apply", "inspect", "prepare", "abandon"]),
  operations: applyAuthoringDraftInputSchema.shape.operations.optional(),
  taskReferences:
    applyAuthoringDraftInputSchema.shape.taskReferences.removeDefault().optional(),
  signalId: applyAuthoringDraftInputSchema.shape.signalId.optional(),
  ownedWorkId: applyAuthoringDraftInputSchema.shape.ownedWorkId.optional(),
  editorialRecommendationId:
    applyAuthoringDraftInputSchema.shape.editorialRecommendationId.optional(),
  contentPlanId: applyAuthoringDraftInputSchema.shape.contentPlanId.optional(),
  paths: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  patchSummary: prepareAuthoringDraftInputSchema.shape.patchSummary.optional(),
  evidence: prepareAuthoringDraftInputSchema.shape.evidence.removeDefault().optional(),
  uncertainty:
    prepareAuthoringDraftInputSchema.shape.uncertainty.removeDefault().optional(),
  checks: prepareAuthoringDraftInputSchema.shape.checks.removeDefault().optional(),
  draftId: abandonAuthoringDraftInputSchema.shape.draftId.optional(),
}).strict().pipe(authoringWorkspaceModeInputSchema);

const outputSchema = z.union([
  z.object({
    mode: z.literal("apply"),
    ok: z.boolean(),
    draft: authoringDraftSchema.nullable(),
    operations: z.array(authoringOperationResultSchema),
    failedOperation: authoringOperationResultSchema.nullable(),
    error: z.string().nullable(),
  }),
  z.object({ mode: z.literal("inspect"), draft: authoringDraftSchema.nullable(), changedFiles: z.array(z.string()), diff: z.string(), files: z.array(z.object({ path: z.string(), content: z.string().nullable(), binary: z.boolean().nullable(), contentHash: z.string().nullable(), sizeBytes: z.number().int().nonnegative().nullable() })) }),
  z.object({ mode: z.literal("prepare"), ok: z.boolean(), draft: authoringDraftSchema.nullable(), report: documentationImpactReportSchema.nullable(), signal: docsSignalDetailSchema.optional(), error: z.string().nullable() }),
  z.object({ mode: z.literal("abandon"), abandoned: z.literal(true), replayed: z.boolean(), draftId: z.string() }),
]);

const MAX_MODEL_DIFF_CHARACTERS = 12_000;
const MAX_MODEL_FILE_CHARACTERS = 4_000;
const MAX_MODEL_TEXT_CHARACTERS = 4_000;

export function authoringWorkspaceModelOutput(output: z.infer<typeof outputSchema>) {
  if (output.mode === "abandon") return { type: "json" as const, value: output };
  if (output.mode === "inspect") {
    return {
      type: "json" as const,
      value: {
        mode: output.mode,
        draft: projectDraft(output.draft),
        changedFiles: output.changedFiles.slice(0, 500),
        diff: projectDiff(output.diff),
        files: output.files.slice(0, 10).map((file) => {
          const content = file.content === null ? null : truncate(file.content, MAX_MODEL_FILE_CHARACTERS);
          return {
            path: file.path,
            content: content?.value ?? null,
            contentTruncated: content?.truncated ?? false,
            binary: file.binary,
            contentHash: file.contentHash,
            sizeBytes: file.sizeBytes,
          };
        }),
      },
    };
  }
  if (output.mode === "apply") {
    return {
      type: "json" as const,
      value: {
        mode: output.mode,
        ok: output.ok,
        draft: projectDraft(output.draft),
        operations: output.operations.slice(0, 50).map(projectOperation),
        failedOperation: output.failedOperation === null ? null : projectOperation(output.failedOperation),
        error: output.error === null ? null : truncate(output.error, 2_000).value,
      },
    };
  }
  return {
    type: "json" as const,
    value: {
      mode: output.mode,
      ok: output.ok,
      draft: projectDraft(output.draft),
      report: output.report === null ? null : {
        decision: output.report.decision,
        affectedPages: output.report.affectedPages.slice(0, 500),
        proposedAction: truncate(output.report.proposedAction, MAX_MODEL_TEXT_CHARACTERS).value,
        evidence: output.report.evidence.slice(0, 50).map((item) => truncate(item, MAX_MODEL_TEXT_CHARACTERS).value),
        uncertainty: output.report.uncertainty.slice(0, 50).map((item) => truncate(item, MAX_MODEL_TEXT_CHARACTERS).value),
        patchSummary: truncate(output.report.patchSummary, 2_000).value,
        checks: output.report.checks.map(projectCheck),
      },
      signal: output.signal === undefined ? undefined : {
        id: output.signal.id,
        status: output.signal.status,
        sourceSummary: truncate(output.signal.sourceSummary, MAX_MODEL_TEXT_CHARACTERS).value,
      },
      error: output.error === null ? null : truncate(output.error, 2_000).value,
    },
  };
}

function projectDraft(draft: z.infer<typeof authoringDraftSchema> | null) {
  if (draft === null) return null;
  return {
    id: draft.id,
    status: draft.status,
    baseRevision: draft.baseRevision,
    taskReferences: draft.taskReferences.slice(0, 20),
    signalId: draft.signalId,
    ownedWorkId: draft.ownedWorkId,
    editorialRecommendationId: draft.editorialRecommendationId,
    editorialRecommendationRevision: draft.editorialRecommendationRevision,
    contentPlanId: draft.contentPlanId,
    contentPlanRevision: draft.contentPlanRevision,
    operationCount: draft.operationCount,
    changedFiles: draft.changedFiles.slice(0, 500),
    checks: draft.checks.map(projectCheck),
    preparedAt: draft.preparedAt,
    preparedDiffHash: draft.preparedDiffHash,
    diff: projectDiff(draft.diff),
  };
}

function projectOperation(operation: z.infer<typeof authoringOperationResultSchema>) {
  return {
    ...operation,
    error: operation.error === undefined ? undefined : truncate(operation.error, 2_000).value,
  };
}

function projectCheck(check: z.infer<typeof documentationImpactReportSchema>["checks"][number]) {
  return { name: check.name, status: check.status, exitCode: check.exitCode };
}

function projectDiff(diff: string) {
  const bounded = truncate(diff, MAX_MODEL_DIFF_CHARACTERS);
  return {
    preview: bounded.value,
    truncated: bounded.truncated,
    contentHash: createHash("sha256").update(diff).digest("hex"),
    sizeBytes: Buffer.byteLength(diff),
  };
}

function truncate(value: string, limit: number) {
  return value.length <= limit
    ? { value, truncated: false }
    : { value: `${value.slice(0, limit)}\n...[truncated]`, truncated: true };
}

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("authoring_workspace")) return null;
  return defineTool({
  description: "Create, revise, inspect, prepare, or abandon one requested draft in the working documentation repository. Use working_repository read results to obtain SHA-256 content hashes before editing. Every update, copy, move, or delete requires the current expectedContentHash; every new target requires createOnly. The complete ordered batch is preflighted before mutation and rolled back exactly on execution failure. Localized signal drafts may omit a content plan; multi-file, new-page, move, copy, delete, and large replacement work requires the matching ready plan. Prepare records checks, the exact diff, and linked signal lifecycle without publishing. Abandon requires the active draftId and is retry-safe. GitHub publication remains separately approval-gated.",
  inputSchema: authoringWorkspaceInputSchema,
  outputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("authoring_workspace", ctx);
    const setup = await requireSetupReady("docs-maintenance");
    const configuredRepository = setup.workingRepositoryInput.workingDocumentationRepository;
    const operationKey = workingRepositoryOperationKey(ctx.session.id, configuredRepository);
    return runWorkingRepositoryOperationSerially(operationKey, async () => {
      const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
      switch (input.mode) {
        case "apply": return { mode: "apply" as const, ...(await applyAuthoringDraft(input, ctx, state)) };
        case "inspect": return { mode: "inspect" as const, ...(await inspectAuthoringDraft(input, ctx, state)) };
        case "prepare": return { mode: "prepare" as const, ...(await prepareAuthoringDraft(input, ctx, state)) };
        case "abandon": return { mode: "abandon" as const, ...(await abandonAuthoringDraft(input, ctx, state)) };
      }
    });
  },
  toModelOutput: authoringWorkspaceModelOutput,
  });
} } });
