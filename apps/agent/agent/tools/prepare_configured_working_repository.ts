import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  repositoryActionRecordSchema,
  type RepositoryActionRecord,
} from "../lib/repository-materialization.js";
import { repositoryMaterializationSchema } from "../lib/repository-workflow-contract.js";
import { loadOrMaterializeRepositoryWorkflowState } from "../lib/working-repository-lifecycle.js";

const outputSchema = z.object({
  materialization: repositoryMaterializationSchema,
  actionProvenance: z.array(repositoryActionRecordSchema),
});

export default defineTool({
  description:
    "Materialize the persisted working documentation repository setup into the sandbox. Use this when workspace setup is already configured and the current session needs /workspace/working-docs prepared.",
  inputSchema: z.object({}),
  outputSchema,
  async execute(_, ctx) {
    const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
    const actionProvenance: RepositoryActionRecord[] = state.actionProvenance;
    const materialization = state.materialization;

    return { materialization, actionProvenance };
  },
});
