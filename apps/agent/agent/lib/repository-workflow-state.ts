import { defineState } from "eve/context";
import { z } from "zod";

import {
  repositoryInputSchema,
  type RepositoryInput,
  type ResolvedRepositoryInput,
  type WorkingDocumentationRepository,
} from "./repository-contract";
import { normalizeRepositoryUrl } from "./repository-materialization";
import {
  docsMaintenanceWorkflowResultSchema,
  authoringDraftSchema,
  contentPlanSchema,
  editorialRecommendationSchema,
  repositoryMaterializationSchema,
  type WorkflowState,
} from "./repository-workflow-contract";
import { repositoryActionRecordSchema } from "./repository-materialization";
import { workingRepositoryValidationProfileSchema } from "./working-repository-service";

const repositoryWorkflowState = defineState<WorkflowState | null>(
  "docs-agent.repository-workflow-state",
  () => null,
);
const configuredRepositoryInputState = defineState<RepositoryInput | null>(
  "docs-agent.configured-repository-input",
  () => null,
);

export async function saveConfiguredRepositoryInput(input: RepositoryInput): Promise<void> {
  const parsed = repositoryInputSchema.parse(input);
  configuredRepositoryInputState.update(() => parsed);
}

export async function loadRepositoryWorkflowState(): Promise<WorkflowState> {
  const state = repositoryWorkflowState.get();

  if (state === null) {
    throw new Error("Working repository has not been materialized in this session.");
  }

  return parseRepositoryWorkflowState(state);
}

export function inspectRepositoryWorkflowState(): WorkflowState | null {
  const state = repositoryWorkflowState.get();
  return state === null ? null : parseRepositoryWorkflowState(state);
}

function parseRepositoryWorkflowState(state: WorkflowState): WorkflowState {
  const repositoryInput = parseResolvedRepositoryInput(state.repositoryInput);

  return {
    repositoryInput,
    materialization: repositoryMaterializationSchema.parse(state.materialization),
    actionProvenance: z.array(repositoryActionRecordSchema).parse(state.actionProvenance),
    repositoryValidationProfile:
      state.repositoryValidationProfile === undefined
        ? undefined
        : workingRepositoryValidationProfileSchema.parse(state.repositoryValidationProfile),
    lastResult:
      state.lastResult === undefined
        ? undefined
        : docsMaintenanceWorkflowResultSchema.parse(state.lastResult),
    contentPlan:
      state.contentPlan === undefined ? undefined : contentPlanSchema.parse(state.contentPlan),
    editorialRecommendation:
      state.editorialRecommendation === undefined
        ? undefined
        : editorialRecommendationSchema.parse(state.editorialRecommendation),
    draft: state.draft === undefined ? undefined : authoringDraftSchema.parse(state.draft),
    lastAbandonedDraftId: state.lastAbandonedDraftId,
  };
}

export async function saveRepositoryWorkflowState(state: WorkflowState): Promise<void> {
  repositoryWorkflowState.update(() => state);
}

export function materializationInputForSetup(setupInput: RepositoryInput): RepositoryInput {
  const configuredInput = configuredRepositoryInputState.get();
  if (
    configuredInput === null ||
    !sameWorkingRepositoryTarget(
      configuredInput.workingDocumentationRepository,
      setupInput.workingDocumentationRepository,
    )
  ) {
    return setupInput;
  }

  const setupDocsRoot = setupInput.workingDocumentationRepository.docsRoot;
  if (
    configuredInput.workingDocumentationRepository.docsRoot !== undefined ||
    setupDocsRoot === undefined
  ) {
    return configuredInput;
  }

  return {
    ...configuredInput,
    workingDocumentationRepository: {
      ...configuredInput.workingDocumentationRepository,
      docsRoot: setupDocsRoot,
    },
  };
}

function parseResolvedRepositoryInput(input: unknown): ResolvedRepositoryInput {
  const parsed = repositoryInputSchema.parse(input);
  const { docsRoot } = parsed.workingDocumentationRepository;

  if (docsRoot === undefined) {
    throw new Error("Working repository docs root has not been resolved in this session.");
  }

  return {
    ...parsed,
    workingDocumentationRepository: {
      ...parsed.workingDocumentationRepository,
      docsRoot,
    },
  };
}

function sameWorkingRepositoryTarget(
  left: WorkingDocumentationRepository,
  right: WorkingDocumentationRepository,
): boolean {
  return (
    normalizeRepositoryUrl(left.source.url) === normalizeRepositoryUrl(right.source.url) &&
    left.ref === right.ref &&
    left.sandboxPath === right.sandboxPath
  );
}
