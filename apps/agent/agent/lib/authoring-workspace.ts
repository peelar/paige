import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  copyRepositoryFile,
  deleteRepositoryFile,
  exportRepositoryDiff,
  listChangedFiles,
  moveRepositoryFile,
  readRepositoryFile,
  resolveRepositoryPath,
  resetRepositoryDraft,
  runRepositoryCheck,
  writeRepositoryBinary,
  writeRepositoryText,
} from "./repository-operations.js";
import { saveRepositoryWorkflowState } from "./repository-workflow-state.js";
import type { WorkflowState } from "./repository-workflow-contract.js";
import { repositoryCheckNameSchema } from "./repository-workflow-contract.js";
import { recommendationMatchesTask } from "./editorial-recommendation.js";

const pathSchema = z.string().trim().min(1);
export const authoringOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("write-text"), path: pathSchema, content: z.string() }),
  z.object({ kind: z.literal("write-binary"), path: pathSchema, contentBase64: z.string().base64().max(14_000_000) }),
  z.object({ kind: z.literal("move"), from: pathSchema, to: pathSchema }),
  z.object({ kind: z.literal("copy"), from: pathSchema, to: pathSchema }),
  z.object({ kind: z.literal("delete"), path: pathSchema }),
]);
export const applyAuthoringDraftInputSchema = z.object({
  operations: z.array(authoringOperationSchema).min(1).max(50),
  taskReferences: z.array(z.string().trim().min(1)).max(20).default([]),
});
export const prepareAuthoringDraftInputSchema = z.object({
  patchSummary: z.string().trim().min(1),
  evidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.array(z.string().trim().min(1)).default([]),
  checks: z.array(repositoryCheckNameSchema).min(1).default(["diff-check"]),
});

type PersistState = (state: WorkflowState) => Promise<void>;

export async function applyAuthoringDraft(input: z.infer<typeof applyAuthoringDraftInputSchema>, ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState): Promise<WorkflowState["draft"]> {
  const parsed = applyAuthoringDraftInputSchema.parse(input);
  const repository = state.repositoryInput.workingDocumentationRepository;
  const editorialRecommendation = requireEditorialRecommendationForDraft(parsed, state);
  const contentPlan = await requireContentPlanForSubstantialWork(parsed, ctx, state);
  for (const operation of parsed.operations) {
    switch (operation.kind) {
      case "write-text": await writeRepositoryText(ctx, repository, operation.path, operation.content, state.actionProvenance); break;
      case "write-binary": await writeRepositoryBinary(ctx, repository, operation.path, operation.contentBase64, state.actionProvenance); break;
      case "move": await moveRepositoryFile(ctx, repository, operation.from, operation.to, state.actionProvenance); break;
      case "copy": await copyRepositoryFile(ctx, repository, operation.from, operation.to, state.actionProvenance); break;
      case "delete": await deleteRepositoryFile(ctx, repository, operation.path, state.actionProvenance); break;
    }
  }
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  state.draft = {
    baseRevision: state.materialization.resolvedCommit ?? state.materialization.requestedRef,
    taskReferences: [...new Set([...(state.draft?.taskReferences ?? []), ...(editorialRecommendation?.taskReferences ?? []), ...(contentPlan?.taskReferences ?? []), ...parsed.taskReferences])],
    editorialRecommendationId: editorialRecommendation?.id ?? state.draft?.editorialRecommendationId,
    editorialRecommendationRevision: editorialRecommendation?.revision ?? state.draft?.editorialRecommendationRevision,
    contentPlanId: contentPlan?.id ?? state.draft?.contentPlanId,
    contentPlanRevision: contentPlan?.revision ?? state.draft?.contentPlanRevision,
    operationCount: (state.draft?.operationCount ?? 0) + parsed.operations.length,
    checks: [], changedFiles, diff,
  };
  state.lastResult = undefined;
  await persistState(state);
  return state.draft;
}

export async function inspectAuthoringDraft(input: { paths?: string[] }, ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState) {
  const repository = state.repositoryInput.workingDocumentationRepository;
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  const files = [];
  for (const path of [...new Set(input.paths ?? [])].slice(0, 10)) {
    try { files.push({ path, content: await readRepositoryFile(ctx, repository, path, state.actionProvenance) }); }
    catch { files.push({ path, content: null }); }
  }
  await persistState(state);
  return { draft: state.draft ?? null, changedFiles, diff, files };
}

export async function prepareAuthoringDraft(input: z.infer<typeof prepareAuthoringDraftInputSchema>, ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState) {
  const parsed = prepareAuthoringDraftInputSchema.parse(input);
  const repository = state.repositoryInput.workingDocumentationRepository;
  if (state.draft?.editorialRecommendationId !== undefined) {
    if (
      state.editorialRecommendation?.id !== state.draft.editorialRecommendationId ||
      state.editorialRecommendation.status === "blocked" ||
      state.editorialRecommendation.status === "complete-no-change"
    ) {
      throw new Error("The editorial recommendation for this draft is missing or does not permit authoring.");
    }
  }
  if (state.draft?.contentPlanId !== undefined) {
    if (state.contentPlan?.id !== state.draft.contentPlanId || state.contentPlan.status !== "ready") {
      throw new Error("The content plan for this authoring draft is missing or blocked. Resolve the plan before preparing the draft.");
    }
  }
  const sandbox = await ctx.getSandbox();
  const head = await sandbox.run({ command: "git rev-parse HEAD", workingDirectory: repository.sandboxPath, abortSignal: ctx.abortSignal });
  const baseRevision = state.materialization.resolvedCommit;
  if (head.exitCode !== 0 || baseRevision === undefined || head.stdout.trim() !== baseRevision) {
    throw new Error(`Authoring draft base is stale. Expected ${baseRevision ?? "a resolved revision"}, found ${head.stdout.trim() || "unknown"}. Re-materialize and rebuild the draft.`);
  }
  const checks = [];
  for (const check of parsed.checks) checks.push(await runRepositoryCheck(ctx, repository, check, state.actionProvenance));
  const changedFiles = await listChangedFiles(ctx, repository, state.actionProvenance);
  const diff = await exportRepositoryDiff(ctx, repository, state.actionProvenance);
  if (changedFiles.length === 0 || diff.trim() === "") throw new Error("Cannot prepare an empty authoring draft.");
  const ok = checks.every(({ status }) => status === "passed");
  state.draft = {
    baseRevision,
    taskReferences: state.draft?.taskReferences ?? [],
    editorialRecommendationId: state.draft?.editorialRecommendationId,
    editorialRecommendationRevision: state.editorialRecommendation?.revision ?? state.draft?.editorialRecommendationRevision,
    contentPlanId: state.draft?.contentPlanId,
    contentPlanRevision: state.contentPlan?.revision ?? state.draft?.contentPlanRevision,
    operationCount: state.draft?.operationCount ?? 0,
    checks,
    changedFiles,
    diff,
    preparedAt: new Date().toISOString(),
  };
  state.lastResult = {
    ok, scenarioKind: "unknown", materialization: state.materialization,
    report: { decision: ok ? "docs-patch" : "ask-maintainer", affectedPages: changedFiles, proposedAction: ok ? "Review the complete authoring draft before approved writeback." : "Fix failed repository checks before publishing.", evidence: parsed.evidence, consideredPages: changedFiles, uncertainty: parsed.uncertainty, patchSummary: parsed.patchSummary, checks },
    changedFiles, diff, noDiff: false, actionProvenance: state.actionProvenance,
    rawSandboxToolsPolicy: "Use only the policy-aware authoring workspace for working-repository changes.",
  };
  await persistState(state);
  return { ok, draft: state.draft, report: state.lastResult.report };
}

export async function abandonAuthoringDraft(ctx: ToolContext, state: WorkflowState, persistState: PersistState = saveRepositoryWorkflowState) {
  await resetRepositoryDraft(ctx, state.repositoryInput.workingDocumentationRepository, state.actionProvenance);
  state.draft = undefined;
  state.lastResult = undefined;
  await persistState(state);
  return { abandoned: true as const };
}

function requireEditorialRecommendationForDraft(
  input: z.infer<typeof applyAuthoringDraftInputSchema>,
  state: WorkflowState,
) {
  const recommendation = state.editorialRecommendation;
  const draftRecommendationId = state.draft?.editorialRecommendationId;
  if (draftRecommendationId !== undefined) {
    if (recommendation?.id !== draftRecommendationId) {
      throw new Error("The editorial recommendation for this authoring draft is missing.");
    }
  } else if (recommendation === undefined || !recommendationMatchesTask(recommendation, input.taskReferences)) {
    return undefined;
  }

  if (recommendation.status === "blocked") {
    throw new Error(`Editorial recommendation pauses drafting: ${recommendation.blockingDecisions.join("; ")}`);
  }
  if (recommendation.status === "complete-no-change") {
    throw new Error("Editorial recommendation selected no change, so no authoring draft should be created.");
  }
  if (recommendation.status === "plan-required") {
    const plan = state.contentPlan;
    if (plan?.status === "blocked" && recommendationMatchesTask(recommendation, plan.taskReferences)) {
      throw new Error(`Content plan is blocked. Resolve before drafting: ${plan.blockers.join("; ")}`);
    }
    if (plan === undefined || !recommendationMatchesTask(recommendation, plan.taskReferences)) {
      throw new Error(`Editorial intervention ${recommendation.chosenIntervention} requires a matching ready content plan before drafting.`);
    }
  }
  return recommendation;
}

async function requireContentPlanForSubstantialWork(
  input: z.infer<typeof applyAuthoringDraftInputSchema>,
  ctx: ToolContext,
  state: WorkflowState,
) {
  const plan = state.contentPlan;
  const draftPlanId = state.draft?.contentPlanId;
  if (draftPlanId !== undefined) {
    if (plan?.id !== draftPlanId || plan.status !== "ready") {
      throw new Error("The content plan for this authoring draft is missing or blocked. Resolve the plan before continuing.");
    }
    return plan;
  }

  const sameTask = plan !== undefined && (
    input.taskReferences.length === 0 ||
    plan.taskReferences.length === 0 ||
    input.taskReferences.some((reference) => plan.taskReferences.includes(reference))
  );
  if (sameTask) {
    if (plan.status === "blocked") {
      throw new Error(`Content plan is blocked. Resolve before drafting: ${plan.blockers.join("; ")}`);
    }
    return plan;
  }

  const reason = await substantialWorkReason(input.operations, ctx, state);
  if (reason === null) return undefined;
  if (plan === undefined) {
    throw new Error(`Content plan required before substantial documentation work (${reason}). Create and share the plan, then continue in the sandbox.`);
  }
  throw new Error(`The active content plan belongs to another task. Create the matching plan before substantial documentation work (${reason}).`);
}

async function substantialWorkReason(
  operations: z.infer<typeof authoringOperationSchema>[],
  ctx: ToolContext,
  state: WorkflowState,
): Promise<string | null> {
  const paths = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === "move" || operation.kind === "copy") {
      paths.add(operation.from);
      paths.add(operation.to);
      return `${operation.kind} operation`;
    }
    paths.add(operation.path);
    if (operation.kind === "delete") return "file removal";
  }
  if (paths.size > 1) return "multi-surface change";

  const operation = operations[0]!;
  const repository = state.repositoryInput.workingDocumentationRepository;
  const sandbox = await ctx.getSandbox();
  if (operation.kind === "write-binary") {
    const path = resolveRepositoryPath(repository, operation.path);
    const current = await sandbox.readBinaryFile({ path, abortSignal: ctx.abortSignal });
    return current === null ? "new asset" : null;
  }
  if (operation.kind === "write-text") {
    const path = resolveRepositoryPath(repository, operation.path);
    const current = await sandbox.readTextFile({ path, abortSignal: ctx.abortSignal });
    if (current === null) return "new page or file";
    if (isLargeReplacement(current, operation.content)) return "large single-file replacement";
  }
  return null;
}

function isLargeReplacement(current: string, next: string): boolean {
  const before = current.split("\n");
  const after = next.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const changed = Math.max(before.length - prefix - suffix, after.length - prefix - suffix);
  return changed >= 50 || (before.length >= 20 && changed >= Math.ceil(before.length / 2));
}
