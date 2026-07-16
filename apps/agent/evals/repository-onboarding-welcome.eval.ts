import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { onboardingEvalIdentity } from "./repository-onboarding-auth";

export default defineEval({
  description:
    "Paige offers repository setup once, respects deferral, and resumes only when access is needed",
  tags: ["repository-onboarding"],
  timeoutMs: 300_000,
  async test(t) {
    const identity = onboardingEvalIdentity();

    const welcome = await t.send({
      message: "Hi Paige.",
      headers: identity.headers,
    });
    welcome.succeeded();
    welcome.messageIncludes(/connect|set up/i);
    welcome.messageIncludes(/repositor|documentation|docs/i);

    const deferred = await t.send({
      message: "Not now, thanks.",
      headers: identity.headers,
    });
    deferred.succeeded();
    deferred.calledTool("repository_configuration", {
      input: { action: "defer" },
    });

    const ordinary = await t.send({
      message: "What kinds of documentation work can you help with?",
      headers: identity.headers,
    });
    ordinary.succeeded();
    t.check(
      ordinary.message,
      satisfies(
        (message) =>
          typeof message === "string" &&
          !/connect (?:a |your )?repositor|set up (?:a |your )?repositor/i.test(
            message,
          ),
        "Paige does not repeat the deferred setup offer",
      ),
    );

    const resumed = await t.send({
      message:
        "Please inspect our documentation repository and tell me what its README covers.",
      headers: identity.headers,
    });
    resumed.succeeded();
    resumed.messageIncludes(/connect|set up|repository/i);
  },
});
