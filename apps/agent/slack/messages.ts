import type { Message, Thread } from "chat";

import type { SlackChannelService } from "./service";
import {
  setSlackReactionPresence,
  slackReactionTarget,
  SLACK_WORKING_REACTION,
} from "./reactions";

type SlackMessageBot = {
  onDirectMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
  onNewMention(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
  onSubscribedMessage(
    handler: (thread: Thread, message: Message) => void | Promise<void>,
  ): void;
};

export function registerSlackMessages(
  slackMessageBot: SlackMessageBot,
  service: Pick<SlackChannelService, "handleMessage">,
): void {
  const handleMessage = async (
    thread: Thread,
    message: Message,
  ) => {
    const result = await service.handleMessage(thread, message);
    if (result.isErr()) throw result.error;
  };

  const acknowledgeMessage = async (thread: Thread, message: Message) => {
    try {
      await setSlackReactionPresence(
        thread.adapter,
        slackReactionTarget(message),
        SLACK_WORKING_REACTION,
        true,
      );
    } catch (error) {
      // A missing reaction is observable in logs, but must not prevent the
      // accepted request from producing its actual answer.
      console.error("Could not acknowledge Paige's Slack request.", error);
    }
  };

  slackMessageBot.onDirectMessage(async (thread, message) => {
    await acknowledgeMessage(thread, message);
    await handleMessage(thread, message);
  });
  slackMessageBot.onNewMention(async (thread, message) => {
    // A mention invites Paige into this conversation. Subscribe before the
    // first reply so every later message continues the same conversation.
    await thread.subscribe();
    await acknowledgeMessage(thread, message);
    await handleMessage(thread, message);
  });
  slackMessageBot.onSubscribedMessage((thread, message) =>
    handleMessage(thread, message)
  );
}
