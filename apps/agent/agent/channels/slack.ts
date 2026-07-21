import { chatSdkChannel } from "eve/channels/chat-sdk";

import { slackAdapter } from "../../slack/adapter";
import { postSlackAuthorizationRequired } from "../../slack/authorization";
import { registerSlackMessages } from "../../slack/messages";
import { quietSlackProgressEvents } from "../../slack/progress";
import { clearSlackWorkingReaction } from "../../slack/reactions";
import { markdownReportFile, pendingSlackReport } from "../../slack/report";
import { SlackChannelService } from "../../slack/service";
import { createSlackState } from "../../slack/state";

export const { bot, channel, send } = chatSdkChannel({
  adapters: {
    // Slack calls Paige directly so Connect cannot filter thread replies.
    // Keep Connect only for rotating outbound bot credentials.
    slack: slackAdapter,
  },
  events: {
    ...quietSlackProgressEvents,
    "authorization.required": async (event, context) => {
      await clearSlackWorkingReaction(context.thread?.adapter ?? null);
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
