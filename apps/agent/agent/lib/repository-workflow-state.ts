import { defineState } from "eve/context";
import { z } from "zod";

import {
  repositoryInputSchema,
  type RepositoryInput,
  type ResolvedRepositoryInput,
  type WorkingDocumentationRepository,
} from "./repository-contract.js";
import { normalizeRepositoryUrl } from "./repository-materialization.js";
import {
  docsMaintenanceWorkflowResultSchema,
  authoringDraftSchema,
  contentPlanSchema,
  editorialRecommendationSchema,
  repositoryMaterializationSchema,
  type WorkflowState,
} from "./repository-workflow-contract.js";
import { repositoryActionRecordSchema } from "./repository-materialization.js";

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

  const repositoryInput = parseResolvedRepositoryInput(state.repositoryInput);

  return {
    repositoryInput,
    materialization: repositoryMaterializationSchema.parse(state.materialization),
    actionProvenance: z.array(repositoryActionRecordSchema).parse(state.actionProvenance),
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
