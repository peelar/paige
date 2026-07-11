import {
  SlackAdapter,
  type SlackAdapterConfig,
  type SlackEvent,
} from "@chat-adapter/slack";
import type { WebhookOptions } from "chat";

const SUPPORTED_MESSAGE_SUBTYPES = new Set([
  "file_share",
  "reply_broadcast",
  "thread_broadcast",
]);

/**
 * Enforces the Slack content-admission boundary before Chat SDK core receives a
 * message. Mentions and DMs retain their existing entry path. An ordinary
 * channel message causes only a thread-id subscription lookup; its content is
 * never parsed or passed to Chat SDK when the thread is not enrolled.
 */
export class SubscriptionFilteredSlackAdapter extends SlackAdapter {
  private readonly admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;

  constructor(
    config: SlackAdapterConfig,
    options: {
      admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;
    } = {},
  ) {
    super(config);
    this.admitOrdinaryMessage = options.admitOrdinaryMessage;
  }

  protected override handleMessageEvent(
    event: SlackEvent,
    options?: WebhookOptions,
  ): void {
    if (shouldIgnoreSlackMessage(event) || this.isMessageFromSelf(event)) return;

    if (event.type === "app_mention" || event.channel_type === "im") {
      this.forwardAcceptedMessage(event, options);
      return;
    }

    if (!event.channel || !event.ts) return;

    const task = this.forwardIfSubscribed(event, options);
    if (options?.waitUntil) {
      options.waitUntil(task);
      return;
    }

    void task.catch((error: unknown) => {
      this.logger.error("Slack subscription prefilter failed", {
        error,
        threadId: slackThreadId(this, event),
      });
    });
  }

  protected forwardAcceptedMessage(
    event: SlackEvent,
    options?: WebhookOptions,
  ): void {
    super.handleMessageEvent(event, options);
  }

  protected async isThreadSubscribed(threadId: string): Promise<boolean> {
    if (!this.chat) {
      throw new Error(
        "Slack subscription prefilter cannot run before Chat SDK initialization.",
      );
    }
    const state = this.chat.getState();
    if (
      this.admitOrdinaryMessage !== undefined &&
      !(await this.admitOrdinaryMessage(threadId))
    ) {
      await state.unsubscribe(threadId);
      return false;
    }
    return state.isSubscribed(threadId);
  }

  private async forwardIfSubscribed(
    event: SlackEvent,
    options?: WebhookOptions,
  ): Promise<void> {
    const threadId = slackThreadId(this, event);
    if (!(await this.isThreadSubscribed(threadId))) return;
    this.forwardAcceptedMessage(event, options);
  }
}

export function createSubscriptionFilteredSlackAdapter(
  config: SlackAdapterConfig,
  options: {
    admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;
  } = {},
): SubscriptionFilteredSlackAdapter {
  return new SubscriptionFilteredSlackAdapter(config, options);
}

export function shouldIgnoreSlackMessage(event: SlackEvent): boolean {
  return (
    event.bot_id !== undefined ||
    event.edited !== undefined ||
    (event.subtype !== undefined && !SUPPORTED_MESSAGE_SUBTYPES.has(event.subtype))
  );
}

function slackThreadId(adapter: SlackAdapter, event: SlackEvent): string {
  return adapter.encodeThreadId({
    channel: event.channel ?? "",
    threadTs: event.thread_ts ?? event.ts ?? "",
  });
}
