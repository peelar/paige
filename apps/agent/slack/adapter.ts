import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";

const connector = process.env.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige";
const signingSecret = process.env.PAIGE_SLACK_SIGNING_SECRET?.trim();
if (!signingSecret) {
  throw new Error("PAIGE_SLACK_SIGNING_SECRET is required.");
}
const { botToken } = connectSlackAdapter(connector);

// The channel harness and Slack-scoped agent tools must use the same adapter
// so reaction behavior and credential rotation cannot drift apart.
export const slackAdapter = createSlackAdapter({ botToken, signingSecret });
