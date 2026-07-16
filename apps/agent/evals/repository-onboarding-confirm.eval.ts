import { defineEval } from "eve/evals";

import {
  onboardingEvalIdentity,
  teammateHeaders,
} from "./repository-onboarding-auth";

export default defineEval({
  description:
    "Paige validates, corrects, confirms, and shares one workspace repository setup",
  tags: ["repository-onboarding-access"],
  timeoutMs: 600_000,
  async test(t) {
    const identity = onboardingEvalIdentity();

    const proposal = await t.send({
      message:
        "Let's set it up. Maintain https://github.com/peelar/paige and use https://github.com/saleor/saleor-dashboard as product evidence.",
      headers: identity.headers,
    });
    proposal.succeeded();
    proposal.noFailedActions();
    proposal.calledTool("repository_configuration", {
      input: {
        action: "propose",
        documentationRepositoryUrl: "https://github.com/peelar/paige",
        evidenceRepositoryUrls: [
          "https://github.com/saleor/saleor-dashboard",
        ],
      },
      output: (output) =>
        JSON.stringify(output).includes('"activated":false'),
    });
    proposal.messageIncludes("peelar/paige");
    proposal.messageIncludes("saleor/saleor-dashboard");

    const corrected = await t.send({
      message:
        "Correction: keep the documentation repository, but remove the product evidence repository.",
      headers: identity.headers,
    });
    corrected.succeeded();
    corrected.noFailedActions();
    corrected.calledTool("repository_configuration", {
      input: {
        action: "propose",
        documentationRepositoryUrl: "https://github.com/peelar/paige",
        evidenceRepositoryUrls: [],
      },
    });

    const confirmed = await t.send({
      message: "Yes, that corrected setup is right. Save it.",
      headers: identity.headers,
    });
    confirmed.succeeded();
    confirmed.calledTool("repository_configuration", {
      input: { action: "confirm" },
      output: (output) => JSON.stringify(output).includes('"activated":true'),
    });

    const teammate = t.newSession();
    const shared = await teammate.send({
      message: "Which repositories are connected for our team?",
      headers: teammateHeaders(identity),
    });
    shared.succeeded();
    shared.calledTool("repository_configuration", {
      input: { action: "read" },
      output: (output) =>
        JSON.stringify(output).includes('"configured":true') &&
        JSON.stringify(output).includes("peelar/paige"),
    });
    shared.messageIncludes("peelar/paige");
  },
});
