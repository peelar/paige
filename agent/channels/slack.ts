import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export const SLACK_CONNECTOR_ENV = "DOCS_AGENT_SLACK_CONNECTOR";
export const DEFAULT_SLACK_CONNECTOR = "slack/docs-agent";

const slackConnector =
  process.env[SLACK_CONNECTOR_ENV]?.trim() || DEFAULT_SLACK_CONNECTOR;

export default slackChannel({
  credentials: connectSlackCredentials(slackConnector),
  threadContext: { since: "last-agent-reply" },
});
