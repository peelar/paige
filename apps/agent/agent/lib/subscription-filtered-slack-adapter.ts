import {
  SlackAdapter,
  type SlackAdapterConfig,
  type SlackEvent,
} from "@chat-adapter/slack";
import type { WebhookOptions } from "chat";

import type { WatchEventAdmission } from "@docs-agent/control-plane/agent";

import {
  redactSlackSearchSecrets,
  stageSlackSearchRequest,
} from "./slack-context-retrieval";

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
  private readonly admitEntryMessage?: (
    entry: "mention" | "direct-message",
  ) => Promise<boolean>;
  private readonly admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;
  private readonly admitWatchEvent?: (
    scope: SlackWatchEventScope,
  ) => Promise<readonly WatchEventAdmission[]>;

  constructor(
    config: SlackAdapterConfig,
    options: {
      admitEntryMessage?: (
        entry: "mention" | "direct-message",
      ) => Promise<boolean>;
      admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;
      admitWatchEvent?: (
        scope: SlackWatchEventScope,
      ) => Promise<readonly WatchEventAdmission[]>;
    } = {},
  ) {
    super(config);
    this.admitEntryMessage = options.admitEntryMessage;
    this.admitOrdinaryMessage = options.admitOrdinaryMessage;
    this.admitWatchEvent = options.admitWatchEvent;
  }

  protected override handleMessageEvent(
    event: SlackEvent,
    options?: WebhookOptions,
  ): void {
    if (shouldIgnoreSlackMessage(event) || this.isMessageFromSelf(event)) return;

    const entry = event.type === "app_mention"
      ? "mention" as const
      : event.channel_type === "im"
        ? "direct-message" as const
        : null;
    if (entry !== null) {
      if (this.admitEntryMessage === undefined) {
        this.forwardAcceptedMessage(event, options);
        return;
      }
      const task = this.forwardIfEntryAdmitted(entry, event, options);
      if (options?.waitUntil) {
        options.waitUntil(task);
      } else {
        void task.catch((error: unknown) => {
          this.logger.error("Slack entry policy check failed", { entry, error });
        });
      }
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
    _options?: WebhookOptions,
  ): Promise<void> {
    stageSlackSearchRequest(
      event,
      (method, body) => this.webClient.apiCall(method, body),
    );
    return this.forwardAcceptedMessageToChatSdk(
      redactSlackSearchSecrets(event),
    );
  }

  protected async forwardAcceptedMessageToChatSdk(
    event: SlackEvent,
  ): Promise<void> {
    if (!this.chat) {
      throw new Error("Slack message cannot be processed before Chat SDK initialization.");
    }
    if (!event.channel || !event.ts) return;

    const isDirectMessage = event.channel_type === "im";
    const threadId = this.encodeThreadId({
      channel: event.channel,
      threadTs: isDirectMessage
        ? event.thread_ts ?? ""
        : event.thread_ts ?? event.ts,
    });
    const isMention = event.type === "app_mention";

    await this.chat.processMessage(this, threadId, async () => {
      const message = await this.parseSlackMessage(event, threadId);
      if (isMention) message.isMention = true;
      return message;
    });
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
    if (this.admitWatchEvent !== undefined) {
      await this.admitWatchEvent(slackWatchEventScope(event));
    }
    const threadId = slackThreadId(this, event);
    if (!(await this.isThreadSubscribed(threadId))) return;
    await this.forwardAcceptedMessage(event, options);
  }

  private async forwardIfEntryAdmitted(
    entry: "mention" | "direct-message",
    event: SlackEvent,
    options?: WebhookOptions,
  ): Promise<void> {
    if (await this.admitEntryMessage!(entry)) {
      await this.forwardAcceptedMessage(event, options);
    }
  }
}

export function createSubscriptionFilteredSlackAdapter(
  config: SlackAdapterConfig,
  options: {
    admitEntryMessage?: (
      entry: "mention" | "direct-message",
    ) => Promise<boolean>;
    admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;
    admitWatchEvent?: (
      scope: SlackWatchEventScope,
    ) => Promise<readonly WatchEventAdmission[]>;
  } = {},
): SubscriptionFilteredSlackAdapter {
  return new SubscriptionFilteredSlackAdapter(config, options);
}

export type SlackWatchEventScope = {
  providerWorkspaceId: string;
  resource: {
    type: "channel";
    id: string;
  };
  eventType: string;
};

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

function slackWatchEventScope(event: SlackEvent): SlackWatchEventScope {
  if (!event.team_id || !event.channel || !event.type) {
    throw new Error(
      "Slack watch admission requires verified workspace, resource, and event identity.",
    );
  }
  return {
    providerWorkspaceId: event.team_id,
    resource: { type: "channel", id: event.channel },
    eventType: event.type,
  };
}
