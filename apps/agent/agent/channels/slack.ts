import { createSlackAdapter } from "@chat-adapter/slack";
import { connectSlackAdapter } from "@vercel/connect/chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";

import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { registerSlackMessages } from "../../slack/messages";
import { markdownReportFile, pendingSlackReport } from "../../slack/report";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

const connector = process.env.PAIGE_SLACK_CONNECTOR?.trim() || "slack/paige";
const signingSecret = process.env.PAIGE_SLACK_SIGNING_SECRET?.trim();
if (!signingSecret) {
  throw new Error("PAIGE_SLACK_SIGNING_SECRET is required.");
}
const { botToken } = connectSlackAdapter(connector);

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    // Slack calls Paige directly so Connect cannot filter thread replies.
    // Keep Connect only for rotating outbound bot credentials.
    slack: createSlackAdapter({ botToken, signingSecret }),
  },
  events: {
    "authorization.required": async (event, context) => {
      await postSlackAuthorizationRequired(event, context.thread);
    },
    "message.completed": async (event, context, ctx) => {
      if (event.finishReason === "tool-calls") {
        context.state.pendingToolCallMessage = firstNonEmptyLine(event.message);
        return;
      }
      context.state.pendingToolCallMessage = null;
      if (!context.thread) return;

      const report = await pendingSlackReport.get();
      if (report?.turnSequence !== ctx.session.turn.sequence) {
        if (!event.message) return;
        await context.thread.post({ markdown: event.message });
        return;
      }

      // The concise answer and its optional evidence must arrive as one Slack
      // message so the attachment never displaces or precedes the answer.
      await context.thread.post({
        files: [markdownReportFile(report)],
        markdown: report.answer,
      });
      await pendingSlackReport.update((current) =>
        current?.turnSequence === report.turnSequence ? null : current
      );
    },
  },
  state: createSlackState(),
  streaming: false,
  userName: "Paige",
});

registerSlackMessages(
  bot,
  new SlackChannelService(send),
);

function firstNonEmptyLine(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return null;

  const lines = message.split(/\r?\n/gu);
  const firstContentLine = lines.find((line) => line.trim().length > 0);
  if (firstContentLine === undefined) return null;

  return firstContentLine.trim();
}

export default channel;
