import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  docsSignalDetailSchema,
  getDocsSignal,
  transitionDocsSignalLifecycle,
  type DocsSignalDetail,
} from "./docs-signals";
import {
  documentationImpactReportSchema,
  docsMaintenanceWorkflowResultSchema,
  repositoryCheckNameSchema,
  type DocsMaintenanceWorkflowResult,
  type RepositoryCheckName,
} from "./repository-workflow-contract";
import {
  exportRepositoryDiff,
  listChangedFiles,
  replaceRepositoryText,
  runRepositoryCheck,
} from "./repository-operations";
import type { RepositoryActionRecord } from "./repository-materialization";
import { saveRepositoryWorkflowState } from "./repository-workflow-state";
import {
  loadOrMaterializeRepositoryWorkflowState,
  reuseMaterializedWorkingRepository,
} from "./working-repository-lifecycle";

const patchHandoffBaseSchema = z.object({
  signalId: z.string().trim().min(1),
  evidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.array(z.string().trim().min(1)).default([]),
});

const preparePatchInputSchema = patchHandoffBaseSchema.extend({
  mode: z.literal("prepare-patch"),
  targetFile: z.string().trim().min(1),
  expectedText: z.string().min(1),
  replacementText: z.string().min(1),
  patchSummary: z.string().trim().min(1),
  proposedAction: z.string().trim().min(1).optional(),
  checks: z.array(repositoryCheckNameSchema).default(["diff-check"]),
});

const noPatchInputSchema = patchHandoffBaseSchema.extend({
  mode: z.literal("no-patch"),
  reason: z.string().trim().min(1),
});

export const prepareDocsSignalPatchInputSchema = z.discriminatedUnion("mode", [
  preparePatchInputSchema,
  noPatchInputSchema,
]);

export const prepareDocsSignalPatchResultSchema = z.object({
  ok: z.boolean(),
  outcome: z.enum(["patch-prepared", "no-patch", "patch-failed"]),
  signal: docsSignalDetailSchema,
  workflowResult: docsMaintenanceWorkflowResultSchema,
  report: documentationImpactReportSchema,
  changedFiles: z.array(z.string()),
  noDiff: z.boolean(),
  approvalRequiredForPublish: z.literal(true),
});

export type PrepareDocsSignalPatchInput = z.infer<
  typeof prepareDocsSignalPatchInputSchema
>;
export type PrepareDocsSignalPatchResult = z.infer<
  typeof prepareDocsSignalPatchResultSchema
>;

export class SignalPatchHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignalPatchHandoffError";
  }
}

export async function prepareDocsSignalPatch(
  input: PrepareDocsSignalPatchInput,
  ctx: ToolContext,
): Promise<PrepareDocsSignalPatchResult> {
  const parsed = prepareDocsSignalPatchInputSchema.parse(input);
  const signal = await getDocsSignal({ id: parsed.signalId });
  assertSignalCanEnterPatchHandoff(signal, parsed.mode);

  const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
  const repositoryInput = state.repositoryInput;
  const repository = repositoryInput.workingDocumentationRepository;
  const actionProvenance = [...state.actionProvenance];
  const materialization = await reuseMaterializedWorkingRepository(
    ctx,
    state,
    actionProvenance,
  );

  if (parsed.mode === "no-patch") {
    const checks = [await runRepositoryCheck(ctx, repository, "status", actionProvenance)];
    const changedFiles = await listChangedFiles(ctx, repository, actionProvenance);
    const diff = await exportRepositoryDiff(ctx, repository, actionProvenance);
    const report = documentationImpactReportSchema.parse({
      decision: "no-docs-change",
      affectedPages: [],
      proposedAction: parsed.reason,
      evidence: buildSignalEvidence(signal, parsed.evidence),
      consideredPages: signal.likelyDocsPages,
      uncertainty: [...signalUncertainty(signal), ...parsed.uncertainty],
      patchSummary: "No patch prepared from the verified docs signal.",
      checks,
    });
    const workflowResult = await saveSignalWorkflowResult({
      ctx,
      repositoryInput,
      materialization,
      report,
      changedFiles,
      diff,
      actionProvenance,
    });
    const updatedSignal = await transitionDocsSignalLifecycle({
      id: signal.id,
      status: "closed-already-covered",
      reason: parsed.reason,
      actor: "docs-agent:signal-patch-handoff",
      links: [],
      artifacts: [
        {
          kind: "verification-report",
          label: "Signal closed without patch",
          metadata: {
            changedFiles,
            noDiff: workflowResult.noDiff,
          },
        },
      ],
      metadata: {
        outcome: "no-patch",
        workflowDecision: report.decision,
      },
    }, "patch-handoff");

    return prepareDocsSignalPatchResultSchema.parse({
      ok: workflowResult.ok,
      outcome: "no-patch",
      signal: updatedSignal,
      workflowResult,
      report,
      changedFiles,
      noDiff: workflowResult.noDiff,
      approvalRequiredForPublish: true,
    });
  }

  let patchError: unknown;
  try {
    await replaceRepositoryText(
      ctx,
      repository,
      parsed.targetFile,
      parsed.expectedText,
      parsed.replacementText,
      actionProvenance,
    );
  } catch (error) {
    patchError = error;
  }

  const checks = patchError === undefined
    ? await runRequestedChecks(ctx, repository, parsed.checks, actionProvenance)
    : [await runRepositoryCheck(ctx, repository, "status", actionProvenance)];
  const changedFiles = await listChangedFiles(ctx, repository, actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, actionProvenance);
  const failedChecks = checks.filter((check) => check.status !== "passed");
  const patchPrepared =
    patchError === undefined &&
    failedChecks.length === 0 &&
    changedFiles.length > 0 &&
    diff.trim().length > 0;
  const report = documentationImpactReportSchema.parse({
    decision: patchPrepared ? "docs-patch" : "ask-maintainer",
    affectedPages: [parsed.targetFile],
    proposedAction:
      parsed.proposedAction ??
      "Review the prepared signal-backed docs patch before any approved writeback.",
    evidence: buildSignalEvidence(signal, parsed.evidence),
    consideredPages: unique([parsed.targetFile, ...signal.likelyDocsPages]),
    uncertainty: [
      ...signalUncertainty(signal),
      ...parsed.uncertainty,
      ...(patchError === undefined ? [] : [`Patch preparation failed: ${formatUnknownError(patchError)}`]),
      ...(failedChecks.length === 0
        ? []
        : [`Checks failed: ${failedChecks.map((check) => check.name).join(", ")}`]),
    ],
    patchSummary: parsed.patchSummary,
    checks,
  });
  const workflowResult = await saveSignalWorkflowResult({
    ctx,
    repositoryInput,
    materialization,
    report,
    changedFiles,
    diff,
    actionProvenance,
  });
  const outcome = patchPrepared ? "patch-prepared" : "patch-failed";
  const updatedSignal = await transitionDocsSignalLifecycle({
    id: signal.id,
    status: outcome,
    reason: patchPrepared
      ? `Prepared docs patch for verified signal ${signal.id}.`
      : `Signal patch handoff failed for ${signal.id}.`,
    actor: "docs-agent:signal-patch-handoff",
    links: [],
    artifacts: [
      {
        kind: patchPrepared ? "diff" : "check-log",
        label: patchPrepared ? "Prepared signal patch diff" : "Failed signal patch handoff",
        metadata: {
          targetFile: parsed.targetFile,
          changedFiles,
          checks: checks.map((check) => ({
            name: check.name,
            status: check.status,
            exitCode: check.exitCode,
          })),
          patchError: patchError === undefined ? undefined : formatUnknownError(patchError),
          noDiff: workflowResult.noDiff,
        },
      },
    ],
    metadata: {
      outcome,
      workflowDecision: report.decision,
      approvalRequiredForPublish: true,
    },
  }, "patch-handoff");

  return prepareDocsSignalPatchResultSchema.parse({
    ok: patchPrepared,
    outcome,
    signal: updatedSignal,
    workflowResult,
    report,
    changedFiles,
    noDiff: workflowResult.noDiff,
    approvalRequiredForPublish: true,
  });
}

export function assertSignalCanEnterPatchHandoff(
  signal: DocsSignalDetail,
  _mode: "prepare-patch" | "no-patch",
): void {
  if (signal.status === "closed-not-docs-relevant") {
    throw new SignalPatchHandoffError("Refusing patch handoff for a closed not-docs-relevant signal.");
  }

  if (signal.status === "closed-already-covered") {
    throw new SignalPatchHandoffError("Refusing patch handoff for a signal already closed as covered.");
  }

  if (signal.status === "draft-pr-opened") {
    throw new SignalPatchHandoffError("Refusing patch handoff because a draft PR is already open.");
  }

  if (signal.status === "needs-source-evidence" || signal.missingEvidence.length > 0) {
    throw new SignalPatchHandoffError(
      "Refusing patch handoff because source evidence is still insufficient.",
    );
  }

  if (signal.status !== "docs-verified" && signal.status !== "patch-failed") {
    throw new SignalPatchHandoffError(
      "Refusing patch handoff until current docs verification has completed for this signal.",
    );
  }
}

async function runRequestedChecks(
  ctx: ToolContext,
  repository: Parameters<typeof runRepositoryCheck>[1],
  checks: RepositoryCheckName[],
  actionProvenance: RepositoryActionRecord[],
) {
  const uniqueChecks = unique(checks);
  const results = [];

  for (const check of uniqueChecks) {
    results.push(await runRepositoryCheck(ctx, repository, check, actionProvenance));
  }

  return results;
}

async function saveSignalWorkflowResult(input: {
  ctx: ToolContext;
  repositoryInput: Awaited<ReturnType<typeof loadOrMaterializeRepositoryWorkflowState>>["repositoryInput"];
  materialization: DocsMaintenanceWorkflowResult["materialization"];
  report: z.infer<typeof documentationImpactReportSchema>;
  changedFiles: string[];
  diff: string;
  actionProvenance: RepositoryActionRecord[];
}): Promise<DocsMaintenanceWorkflowResult> {
  const workflowResult = docsMaintenanceWorkflowResultSchema.parse({
    ok: input.report.checks.every((check) => check.status === "passed"),
    materialization: input.materialization,
    report: input.report,
    changedFiles: input.changedFiles,
    diff: input.diff,
    noDiff: input.changedFiles.length === 0 && input.diff.trim().length === 0,
    actionProvenance: input.actionProvenance,
    rawSandboxToolsPolicy:
      "Repository work is executed through authored tools and the policy-aware repository workflow; raw Eve bash/read_file/write_file/glob/grep tools are disabled for this agent.",
  });
  const sandbox = await input.ctx.getSandbox();
  await sandbox.writeTextFile({
    path: ".docs-agent/last-result.json",
    content: `${JSON.stringify(workflowResult, null, 2)}\n`,
    abortSignal: input.ctx.abortSignal,
  });
  await saveRepositoryWorkflowState({
    repositoryInput: input.repositoryInput,
    materialization: input.materialization,
    actionProvenance: input.actionProvenance,
    lastResult: workflowResult,
  });

  return workflowResult;
}

function buildSignalEvidence(signal: DocsSignalDetail, additionalEvidence: string[]): string[] {
  return [
    `Signal ${signal.id}: ${signal.sourceSummary}`,
    ...signal.sources.map((source) =>
      [
        `Source ${source.kind}`,
        source.provider === null ? undefined : `provider=${source.provider}`,
        source.providerId === null ? undefined : `providerId=${source.providerId}`,
        source.permalink === null ? undefined : `url=${source.permalink}`,
        source.title === null ? undefined : `title=${source.title}`,
      ].filter(Boolean).join("; "),
    ),
    ...signal.extractedClaims.map((claim) => `Claim: ${claim}`),
    ...signal.productSurfaces.map((surface) => `Product surface: ${surface}`),
    ...additionalEvidence,
  ];
}

function signalUncertainty(signal: DocsSignalDetail): string[] {
  return [
    ...(signal.uncertainty === null ? [] : [signal.uncertainty]),
    ...signal.missingEvidence.map((item) => `Missing evidence: ${item}`),
  ];
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean) as T[])];
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
