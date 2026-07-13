import {
  SlackAdapter,
  type SlackAdapterConfig,
  type SlackEvent,
} from "@chat-adapter/slack";
import type { WebhookOptions } from "chat";

import type {
  EphemeralWatchObservation,
  WatchEventAdmission,
  WatchObservationClaimResult,
} from "@docs-agent/control-plane/agent";

import {
  redactSlackSearchSecrets,
  stageSlackSearchRequest,
} from "./slack-context-retrieval";
import {
  isSlackWatchObservationCandidateMetadata,
  isSupportedSlackWatchObservationEvent,
  type SlackWatchObservationInput,
} from "./slack-watch-observation";

const SUPPORTED_MESSAGE_SUBTYPES = new Set([
  "file_share",
  "reply_broadcast",
  "thread_broadcast",
]);

/**
 * Enforces the Slack content-admission boundary before Chat SDK core receives a
 * message. Mentions and DMs retain their existing entry path. An ordinary
 * channel message exposes metadata to watch admission before any content read,
 * then runs the separate thread-id subscription lookup. Rejected watch content
 * is never normalized, and unenrolled content never reaches Chat SDK.
 */
export class SubscriptionFilteredSlackAdapter extends SlackAdapter {
  private readonly admitEntryMessage?: (
    entry: "mention" | "direct-message",
  ) => Promise<boolean>;
  private readonly admitOrdinaryMessage?: (threadId: string) => Promise<boolean>;
  private readonly admitWatchEvent?: (
    scope: SlackWatchEventScope,
  ) => Promise<readonly WatchEventAdmission[]>;
  private readonly normalizeWatchEvent?: (
    input: SlackWatchObservationInput,
  ) => EphemeralWatchObservation | Promise<EphemeralWatchObservation>;
  private readonly claimWatchObservation?: (
    input: ClaimNormalizedWatchObservationInput,
  ) => Promise<WatchObservationClaimResult>;

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
      normalizeWatchEvent?: (
        input: SlackWatchObservationInput,
      ) => EphemeralWatchObservation | Promise<EphemeralWatchObservation>;
      claimWatchObservation?: (
        input: ClaimNormalizedWatchObservationInput,
      ) => Promise<WatchObservationClaimResult>;
    } = {},
  ) {
    super(config);
    this.admitEntryMessage = options.admitEntryMessage;
    this.admitOrdinaryMessage = options.admitOrdinaryMessage;
    this.admitWatchEvent = options.admitWatchEvent;
    this.normalizeWatchEvent = options.normalizeWatchEvent;
    this.claimWatchObservation = options.claimWatchObservation;
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
    let watchFailure: unknown;
    try {
      await this.normalizeIfWatchAdmitted(event);
    } catch (error) {
      watchFailure = error;
    }
    const threadId = slackThreadId(this, event);
    if (await this.isThreadSubscribed(threadId)) {
      await this.forwardAcceptedMessage(event, options);
    }
    if (watchFailure !== undefined) throw watchFailure;
  }

  protected async resolveWatchMessagePermalink(
    event: SlackEvent,
  ): Promise<string> {
    const response = await this.webClient.apiCall("chat.getPermalink", {
      channel: event.channel,
      message_ts: event.ts,
    }) as { ok?: boolean; permalink?: unknown };
    if (response.ok !== true || typeof response.permalink !== "string") {
      throw new Error("Slack did not return a permalink for the admitted watch message.");
    }
    return response.permalink;
  }

  private async normalizeIfWatchAdmitted(event: SlackEvent): Promise<void> {
    const isSelf = this.isMessageFromSelf(event);
    if (
      this.admitWatchEvent === undefined ||
      !isSlackWatchObservationCandidateMetadata(event, isSelf)
    ) return;

    const admissions = await this.admitWatchEvent(slackWatchEventScope(event));
    if (admissions.length === 0) return;
    if (!isSupportedSlackWatchObservationEvent(event, isSelf)) return;
    if (
      this.normalizeWatchEvent === undefined ||
      this.claimWatchObservation === undefined
    ) {
      throw new Error(
        "Slack watch admission requires a configured observation normalizer and durable claim service.",
      );
    }

    const permalink = await this.resolveWatchMessagePermalink(event);
    const receivedAt = new Date().toISOString();
    const normalized = await Promise.all(admissions.map(async (admission) => ({
      admission,
      observation: await this.normalizeWatchEvent!({
        event,
        admission,
        isSelf,
        permalink,
        receivedAt,
      }),
    })));
    await Promise.all(normalized.map((input) =>
      this.claimWatchObservation!(input)
    ));
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
    normalizeWatchEvent?: (
      input: SlackWatchObservationInput,
    ) => EphemeralWatchObservation | Promise<EphemeralWatchObservation>;
    claimWatchObservation?: (
      input: ClaimNormalizedWatchObservationInput,
    ) => Promise<WatchObservationClaimResult>;
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

export type ClaimNormalizedWatchObservationInput = {
  admission: WatchEventAdmission;
  observation: EphemeralWatchObservation;
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
