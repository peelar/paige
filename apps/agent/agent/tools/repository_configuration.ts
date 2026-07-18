import { defineTool } from "eve/tools";
import { z } from "zod";

import { repositoryConfigurationStore } from "../../repositories/configuration/database";
import {
  clearRepositoryConfigurationProposal,
  deferRepositoryConfiguration,
  proposeRepositoryConfiguration,
  repositoryConfigurationSessionState,
} from "../../repositories/configuration/draft";
import {
  RepositoryConfigurationService,
  summarizeRepositoryConfiguration,
} from "../../repositories/configuration/service";

const actionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  z.object({
    action: z.literal("propose"),
    documentationRepositoryUrl: z.string().min(1),
    evidenceRepositoryUrls: z.array(z.string().min(1)).default([]),
  }),
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("discard") }),
  z.object({ action: z.literal("defer") }),
]);

export const repositoryConfigurationToolInputSchema = z.object({
  action: z.enum(["read", "propose", "confirm", "discard", "defer"]),
  documentationRepositoryUrl: z.string().min(1).optional(),
  evidenceRepositoryUrls: z.array(z.string().min(1)).optional(),
}).strict().pipe(actionInputSchema);

export default defineTool({
  description:
    "Manage this agent's repository setup. Read the active and proposed setup; propose a complete replacement after collecting one documentation GitHub URL and any optional product-evidence GitHub URLs; confirm only after the user explicitly says the summary is correct; discard a proposal for corrections; or defer when the user says not now. Proposals validate access but do not activate anything.",
  inputSchema: repositoryConfigurationToolInputSchema,
  async execute(input, ctx) {
    const service = new RepositoryConfigurationService(
      ctx,
      repositoryConfigurationStore(),
    );
    const session = repositoryConfigurationSessionState.get();

    switch (input.action) {
      case "read": {
        const active = await service.get().match(
          (value) => value,
          raiseRepositoryError,
        );
        return {
          action: input.action,
          configured: active !== undefined,
          active: active === undefined
            ? undefined
            : {
              ...summarizeRepositoryConfiguration(active),
              revision: active.revision,
            },
          proposed: session.proposal === undefined
            ? undefined
            : summarizeRepositoryConfiguration(
              session.proposal.configuration,
            ),
          deferred: session.deferred,
        };
      }
      case "propose": {
        const active = await service.get().match(
          (value) => value,
          raiseRepositoryError,
        );
        const configuration = await service.propose(input).match(
          (value) => value,
          raiseRepositoryError,
        );
        repositoryConfigurationSessionState.update(() =>
          proposeRepositoryConfiguration(
            active?.revision ?? null,
            configuration,
          )
        );
        return {
          action: input.action,
          proposed: summarizeRepositoryConfiguration(configuration),
          activated: false,
        };
      }
      case "confirm": {
        if (session.proposal === undefined) {
          throw new Error(
            "There is no proposed repository setup to confirm.",
          );
        }
        const active = await service.confirm({
          configuration: session.proposal.configuration,
          expectedRevision: session.proposal.baseRevision,
        }).match((value) => value, raiseRepositoryError);
        repositoryConfigurationSessionState.update(() =>
          clearRepositoryConfigurationProposal()
        );
        return {
          action: input.action,
          active: {
            ...summarizeRepositoryConfiguration(active),
            revision: active.revision,
          },
          activated: true,
        };
      }
      case "discard":
        repositoryConfigurationSessionState.update(() =>
          clearRepositoryConfigurationProposal()
        );
        return { action: input.action, discarded: true };
      case "defer":
        repositoryConfigurationSessionState.update(() =>
          deferRepositoryConfiguration()
        );
        return { action: input.action, deferred: true };
    }
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
