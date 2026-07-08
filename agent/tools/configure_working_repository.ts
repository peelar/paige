import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryInputSchema } from "../lib/repository-contract.js";
import {
  materializeWorkingRepository,
  type RepositoryActionRecord,
  repositoryActionRecordSchema,
  repositoryMaterializationSchema,
} from "../lib/repository-workflow.js";
import {
  DOCS_MAINTAINER_CONFIG_PATH,
  writeConfiguredRepositoryInput,
} from "../lib/docs-maintainer-config.js";

const outputSchema = z.object({
  configured: z.literal(true),
  configPath: z.string(),
  materialization: repositoryMaterializationSchema,
  actionProvenance: z.array(repositoryActionRecordSchema),
});

export default defineTool({
  description:
    "Configure the app-local working documentation repository, materialize it in the sandbox, and persist the validated repository input to the untracked docs maintainer config file.",
  inputSchema: repositoryInputSchema,
  outputSchema,
  async execute(input, ctx) {
    const actionProvenance: RepositoryActionRecord[] = [];
    const materialization = await materializeWorkingRepository(ctx, input, actionProvenance);

    await writeConfiguredRepositoryInput(input);

    return {
      configured: true as const,
      configPath: DOCS_MAINTAINER_CONFIG_PATH,
      materialization,
      actionProvenance,
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        configured: output.configured,
        repository: output.materialization.repositoryUrl,
        ref: output.materialization.requestedRef,
        resolvedCommit: output.materialization.resolvedCommit,
        docsRoot: output.materialization.docsRoot,
        sandboxPath: output.materialization.sandboxPath,
        configPath: output.configPath,
      },
    };
  },
});
