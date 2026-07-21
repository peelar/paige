import type { Thread } from "chat";

import {
  beginSlackReactionTurn,
  clearSlackWorkingReaction,
} from "./reactions";

function suppressSlackTraceStatus(): void {}

export const quietSlackProgressEvents = {
  "actions.requested": suppressSlackTraceStatus,
  "session.waiting": async (
    _event: unknown,
    channel: { thread: Thread | null },
  ) => {
    await clearSlackWorkingReaction(channel.thread?.adapter ?? null);
  },
  "turn.completed": async (
    _event: unknown,
    channel: { thread: Thread | null },
  ) => {
    await clearSlackWorkingReaction(channel.thread?.adapter ?? null);
  },
  "turn.started": (
    _event: unknown,
    channel: {
      state: { thread: Parameters<typeof beginSlackReactionTurn>[0] };
    },
  ) => {
    // Keep Slack quiet while making the active inbound message available to
    // the scoped reaction tool before the model's first step.
    beginSlackReactionTurn(channel.state.thread);
  },
};
