import { defineDynamic, defineInstructions } from "eve/instructions";

import { repositoryConfigurationStore } from "../../repositories/configuration/database";
import {
  repositoryConfigurationSessionState,
} from "../../repositories/configuration/draft";
import {
  summarizeRepositoryConfiguration,
} from "../../repositories/configuration/service";

export default defineDynamic({
  events: {
    "turn.started": async (_event, _ctx) => {
      const session = repositoryConfigurationSessionState.get();
      const active = await repositoryConfigurationStore()
        .get();
      if (active.isErr()) throw active.error;

      if (session.proposal !== undefined) {
        const proposal = summarizeRepositoryConfiguration(
          session.proposal.configuration,
        );
        return defineInstructions({
          markdown: proposalInstructions(proposal),
        });
      }

      if (active.value !== undefined) {
        return defineInstructions({
          markdown:
            "This agent has an active repository setup. Use repository_configuration read when the user asks to see or change it. Any change must be proposed as a complete summary and activated only after the user confirms that summary.",
        });
      }

      return defineInstructions({
        markdown: session.deferred
          ? deferredInstructions
          : firstRunInstructions,
      });
    },
  },
});

const firstRunInstructions = `
This agent has not connected repositories yet.

Welcome the user and briefly explain that connecting repositories lets Paige
maintain their documentation and check it against where the product is built.
Ask whether they would like to set that up now. Do not ask for URLs until they
agree. If they decline, call repository_configuration with defer and continue
the conversation without nagging.

Keep the explanation in normal product language. Never mention internal roles,
scopes, catalogs, tokens, worktrees, databases, or runtime architecture.
`;

const deferredInstructions = `
This agent has no repository setup, and someone already chose not to
set it up for now. Do not mention setup during ordinary conversation. If the
current request actually needs repository access, briefly explain why
connecting repositories is needed and offer to resume setup.
`;

function proposalInstructions(proposal: {
  documentationRepository: string;
  evidenceRepositories: string[];
}): string {
  const evidence = proposal.evidenceRepositories.length === 0
    ? "No product repositories"
    : proposal.evidenceRepositories.join(", ");
  return `
There is an unconfirmed repository setup for this agent:

- Documentation to maintain: ${proposal.documentationRepository}
- Product repositories to check: ${evidence}

Present this clearly and ask whether it looks right. Call
repository_configuration confirm only after the user explicitly confirms.
If they correct anything, collect the correction and call propose again with
the complete desired setup. Do not expose internal implementation terms.
`;
}
