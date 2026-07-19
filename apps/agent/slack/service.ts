import type { Message, Thread } from "chat";
import { err, ok, ResultAsync } from "neverthrow";
import type { Result } from "neverthrow";

// Eve discovers every module under agent/channels as a channel entrypoint, so
// channel behavior that is not an entrypoint stays in this product module.
type DirectMessageSend = (
  message: string,
  options: {
    thread: Thread;
    auth: {
      authenticator: "slack";
      principalType: "user";
      principalId: string;
      attributes: { slackWorkspaceId: string };
    };
  },
) => Promise<unknown>;

export type SlackChannelErrorCode =
  | "SLACK_INVALID_MESSAGE"
  | "SLACK_SESSION_DISPATCH_FAILED";

/** A failure while turning a verified Slack message into an Eve session. */
export class SlackChannelError extends Error {
  override readonly name = "SlackChannelError";

  constructor(
    readonly code: SlackChannelErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class SlackChannelService {
  readonly #sendMessage: DirectMessageSend;

  constructor(sendMessage: DirectMessageSend) {
    this.#sendMessage = sendMessage;
  }

  handleMessage(
    thread: Thread,
    message: Message,
  ): ResultAsync<void, SlackChannelError> {
    return extractSlackWorkspaceId(message).asyncAndThen(
      (slackWorkspaceId) =>
        ResultAsync.fromPromise(
          this.#sendMessage(message.text, {
            thread,
            auth: {
              authenticator: "slack",
              principalType: "user",
              principalId: message.author.userId,
              attributes: { slackWorkspaceId },
            },
          }),
          (cause) =>
            new SlackChannelError(
              "SLACK_SESSION_DISPATCH_FAILED",
              "The Slack message could not start or continue an agent session.",
              { cause },
            ),
        ).map(() => undefined),
    );
  }
}

export function extractSlackWorkspaceId(
  message: Message,
): Result<string, SlackChannelError> {
  if (typeof message.raw !== "object" || message.raw === null) {
    return err(missingWorkspaceId());
  }

  const raw = message.raw as Record<string, unknown>;
  const workspaceId = typeof raw.team_id === "string"
    ? raw.team_id
    : typeof raw.team === "string"
    ? raw.team
    : undefined;
  return workspaceId === undefined || workspaceId.length === 0
    ? err(missingWorkspaceId())
    : ok(workspaceId);
}

function missingWorkspaceId(): SlackChannelError {
  return new SlackChannelError(
    "SLACK_INVALID_MESSAGE",
    "Slack message is missing its verified workspace ID.",
  );
}
