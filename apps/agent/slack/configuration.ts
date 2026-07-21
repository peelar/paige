export type SlackRuntimeConfiguration =
  | {
    readonly mode: "connect";
    readonly connector: string;
    readonly signingSecret: string;
  }
  | {
    readonly mode: "preview";
    readonly botToken: string;
    readonly signingSecret: string;
  };

export function resolveSlackRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): SlackRuntimeConfiguration {
  const mode = environment.PAIGE_SLACK_MODE?.trim() || "connect";

  if (mode === "connect") {
    return {
      mode,
      connector: environment.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige",
      signingSecret: requiredEnvironmentValue(
        environment,
        "PAIGE_SLACK_SIGNING_SECRET",
      ),
    };
  }

  if (mode === "preview") {
    return {
      mode,
      botToken: requiredEnvironmentValue(
        environment,
        "PAIGE_SLACK_PREVIEW_BOT_TOKEN",
      ),
      signingSecret: requiredEnvironmentValue(
        environment,
        "PAIGE_SLACK_PREVIEW_SIGNING_SECRET",
      ),
    };
  }

  throw new Error(
    `PAIGE_SLACK_MODE must be "connect" or "preview"; received ${JSON.stringify(mode)}.`,
  );
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
