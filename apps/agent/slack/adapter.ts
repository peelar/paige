import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";

import { resolveSlackRuntimeConfiguration } from "./configuration";

const configuration = resolveSlackRuntimeConfiguration(process.env);
const adapterConfiguration = configuration.mode === "connect"
  ? connectAdapterConfiguration(configuration)
  : {
    botToken: configuration.botToken,
    signingSecret: configuration.signingSecret,
  };

// The channel harness and Slack-scoped agent tools must use the same adapter
// so reaction behavior and credential rotation cannot drift apart.
export const slackAdapter = createSlackAdapter(adapterConfiguration);

function connectAdapterConfiguration(
  input: Extract<typeof configuration, { mode: "connect" }>,
) {
  // Slack calls Paige directly. Connect owns only the rotating outbound token;
  // its trigger verifier must not replace Slack signature verification here.
  const { botToken } = connectSlackAdapter(input.connector);
  return { botToken, signingSecret: input.signingSecret };
}
