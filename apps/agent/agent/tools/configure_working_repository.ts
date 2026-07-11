import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryInputSchema } from "../lib/repository-contract.js";
import { repositoryMaterializationSchema } from "../lib/repository-workflow-contract.js";
import { saveConfiguredRepositoryInput } from "../lib/repository-workflow-state.js";
import {
  repositoryActionRecordSchema,
  type RepositoryActionRecord,
} from "../lib/repository-materialization.js";
import { saveWorkingRepositorySetup } from "../lib/setup-state.js";
import {
  materializeWorkingRepository,
  validateWorkingRepositorySetup,
} from "../lib/working-repository-lifecycle.js";

const outputSchema = z.object({
  configured: z.literal(true),
  repository: z.string(),
  ref: z.string(),
  docsRoot: z.string().optional(),
  sandboxPath: z.string(),
  watchedRepositories: z.number(),
  materialized: z.boolean(),
  materialization: repositoryMaterializationSchema.optional(),
  actionProvenance: z.array(repositoryActionRecordSchema),
});

const inputSchema = repositoryInputSchema.extend({
  prepareNow: z
    .boolean()
    .default(false)
    .describe("Materialize the repository immediately. Leave false for fast setup."),
});

export default defineTool({
  description:
    "Configure the session working documentation repository. Validates and persists setup quickly; set prepareNow only when the sandbox checkout is needed immediately.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    const repositoryInput = repositoryInputSchema.parse(input);
    const actionProvenance: RepositoryActionRecord[] = [
      ...(await validateWorkingRepositorySetup(repositoryInput, ctx.abortSignal)),
    ];
    await saveConfiguredRepositoryInput(repositoryInput);

    if (!input.prepareNow) {
      await saveWorkingRepositorySetup(repositoryInput);

      const repository = repositoryInput.workingDocumentationRepository;
      return {
        configured: true as const,
        repository: repository.source.url,
        ref: repository.ref,
        docsRoot: repository.docsRoot,
        sandboxPath: repository.sandboxPath,
        watchedRepositories: repositoryInput.watchedRepositories.length,
        materialized: false,
        actionProvenance,
      };
    }

    const materialization = await materializeWorkingRepository(
      ctx,
      repositoryInput,
      actionProvenance,
    );
    await saveWorkingRepositorySetup({
      ...repositoryInput,
      workingDocumentationRepository: {
        ...repositoryInput.workingDocumentationRepository,
        docsRoot: materialization.docsRoot,
      },
    });

    return {
      configured: true as const,
      repository: materialization.repositoryUrl,
      ref: materialization.requestedRef,
      docsRoot: materialization.docsRoot,
      sandboxPath: materialization.sandboxPath,
      watchedRepositories: repositoryInput.watchedRepositories.length,
      materialized: true,
      materialization,
      actionProvenance,
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        configured: output.configured,
        repository: output.repository,
        ref: output.ref,
        resolvedCommit: output.materialization?.resolvedCommit,
        docsRoot: output.docsRoot,
        sandboxPath: output.sandboxPath,
        watchedRepositories: output.watchedRepositories,
        materialized: output.materialized,
      },
    };
  },
});
