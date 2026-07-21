import type { Adapter, Message } from "chat";
import { defineState } from "eve/context";
import { z } from "zod";

export const SLACK_WORKING_REACTION = "ice_cube";

const slackReactionNameSchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9_+-]+$/u,
    "Use a Slack emoji name without surrounding colons.",
  );

export const agentSlackReactionNameSchema = slackReactionNameSchema.refine(
  (name) => name !== SLACK_WORKING_REACTION,
  "The working reaction is managed by the Slack harness.",
);

export interface SlackReactionTarget {
  readonly messageId: string;
  readonly threadId: string;
}

export interface SlackReactionTurnState {
  readonly agentReaction: string | null;
  readonly target: SlackReactionTarget | null;
  readonly workingReactionPresent: boolean;
}

export type SlackReactionClient = Pick<
  Adapter,
  "addReaction" | "removeReaction"
>;
type SlackReactionThread = {
  readonly currentMessage?: Pick<Message, "id" | "isMention" | "threadId">;
  readonly isDM: boolean;
};

export const slackReactionTurnState = defineState<SlackReactionTurnState>(
  "paige.slack-reaction-turn",
  () => ({
    agentReaction: null,
    target: null,
    workingReactionPresent: false,
  }),
);

export function slackReactionTarget(
  message: Pick<Message, "id" | "threadId">,
): SlackReactionTarget {
  return { messageId: message.id, threadId: message.threadId };
}

export function beginSlackReactionTurn(
  thread: SlackReactionThread | null,
): void {
  slackReactionTurnState.update(() => slackReactionTurnForThread(thread));
}

export function slackReactionTurnForThread(
  thread: SlackReactionThread | null,
): SlackReactionTurnState {
  const message = thread?.currentMessage;
  return {
    agentReaction: null,
    target: message === undefined ? null : slackReactionTarget(message),
    workingReactionPresent: message !== undefined &&
      (thread?.isDM === true || message.isMention === true),
  };
}

export function claimAgentSlackReaction(
  target: SlackReactionTarget,
  reaction: string,
): void {
  slackReactionTurnState.update((current) => {
    if (!sameSlackReactionTarget(current.target, target)) {
      throw new Error(
        "The active Slack message changed before it was reacted to.",
      );
    }
    if (current.agentReaction !== null) {
      throw new Error("Paige already reacted to this Slack message.");
    }
    return { ...current, agentReaction: reaction };
  });
}

export function releaseAgentSlackReactionClaim(
  target: SlackReactionTarget,
  reaction: string,
): void {
  slackReactionTurnState.update((current) =>
    sameSlackReactionTarget(current.target, target) &&
      current.agentReaction === reaction
      ? { ...current, agentReaction: null }
      : current
  );
}

function releaseSlackWorkingReaction(): SlackReactionTarget | null {
  const current = slackReactionTurnState.get();
  if (!current.workingReactionPresent) return null;
  slackReactionTurnState.update((state) => ({
    ...state,
    workingReactionPresent: false,
  }));
  return current.target;
}

export async function clearSlackWorkingReaction(
  client: SlackReactionClient | null,
): Promise<void> {
  const target = releaseSlackWorkingReaction();
  if (target === null || client === null) return;

  try {
    await setSlackReactionPresence(
      client,
      target,
      SLACK_WORKING_REACTION,
      false,
    );
  } catch (error) {
    // Reaction failures must not turn completed agent work into a failed turn.
    console.error("Could not clear Paige's Slack working reaction.", error);
  }
}

export async function setSlackReactionPresence(
  client: SlackReactionClient,
  target: SlackReactionTarget,
  reaction: string,
  present: boolean,
): Promise<void> {
  const parsedReaction = slackReactionNameSchema.parse(reaction);
  if (present) {
    await client.addReaction(target.threadId, target.messageId, parsedReaction);
    return;
  }
  await client.removeReaction(
    target.threadId,
    target.messageId,
    parsedReaction,
  );
}

function sameSlackReactionTarget(
  left: SlackReactionTarget | null,
  right: SlackReactionTarget,
): boolean {
  return left?.messageId === right.messageId &&
    left.threadId === right.threadId;
}
