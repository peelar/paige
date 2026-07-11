import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryInputSchema } from "../lib/repository-contract.js";
import {
  materializeWorkingRepository,
  saveConfiguredRepositoryInput,
  type RepositoryActionRecord,
  repositoryActionRecordSchema,
  repositoryMaterializationSchema,
} from "../lib/repository-workflow.js";
import { saveWorkingRepositorySetup } from "../lib/setup-state.js";

const outputSchema = z.object({
  materialization: repositoryMaterializationSchema,
  actionProvenance: z.array(repositoryActionRecordSchema),
});

export default defineTool({
  description:
    "Materialize a validated GitHub working documentation repository into the sandbox at /workspace/working-docs. Defaults the ref to main and detects the docs root when omitted.",
  inputSchema: repositoryInputSchema,
  outputSchema,
  async execute(input, ctx) {
    const actionProvenance: RepositoryActionRecord[] = [];
    await saveConfiguredRepositoryInput(input);
    const materialization = await materializeWorkingRepository(ctx, input, actionProvenance);
    await saveWorkingRepositorySetup({
      ...input,
      workingDocumentationRepository: {
        ...input.workingDocumentationRepository,
        docsRoot: materialization.docsRoot,
      },
    });
    return { materialization, actionProvenance };
  },
});
