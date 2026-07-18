import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { onboardingEvalIdentity } from "./repository-onboarding-auth";

export default defineEval({
  description:
    "Paige collects the documentation repository before asking separately for optional evidence repositories",
  tags: ["repository-onboarding"],
  timeoutMs: 300_000,
  async test(t) {
    const identity = onboardingEvalIdentity();

    const welcome = await t.send({
      message: "Hi Paige.",
      headers: identity.headers,
    });
    welcome.succeeded();

    const accepted = await t.send({
      message: "Yes, let's set it up.",
      headers: identity.headers,
    });
    accepted.succeeded();
    accepted.messageIncludes(/documentation|docs/i);
    t.check(
      accepted.message,
      satisfies(
        (message) =>
          typeof message === "string" &&
          !/evidence|product repositor|code repositor/i.test(message),
        "Paige asks only for the documentation repository first",
      ),
    );
    accepted.notCalledTool("repository_configuration");

    const documentation = await t.send({
      message: "https://github.com/peelar/saleor-docs",
      headers: identity.headers,
    });
    documentation.succeeded();
    documentation.messageIncludes(/evidence|product|code/i);
    documentation.messageIncludes(/optional|if you|any/i);
    documentation.notCalledTool("repository_configuration");
  },
});
