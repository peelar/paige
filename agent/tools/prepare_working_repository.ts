import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryInputSchema } from "../lib/repository-contract.js";
import {
  materializeWorkingRepository,
  type RepositoryActionRecord,
  repositoryActionRecordSchema,
  repositoryMaterializationSchema,
} from "../lib/repository-workflow.js";

const outputSchema = z.object({
  materialization: repositoryMaterializationSchema,
  actionProvenance: z.array(repositoryActionRecordSchema),
});

export default defineTool({
  description:
    "Materialize a validated GitHub working documentation repository into the sandbox at /workspace/working-docs.",
  inputSchema: repositoryInputSchema,
  outputSchema,
  async execute(input, ctx) {
    const actionProvenance: RepositoryActionRecord[] = [];
    const materialization = await materializeWorkingRepository(ctx, input, actionProvenance);
    return { materialization, actionProvenance };
  },
});
