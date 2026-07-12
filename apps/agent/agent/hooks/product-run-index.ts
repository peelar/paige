import { projectProductRunEventByReference } from "@docs-agent/control-plane/agent";
import { defineHook } from "eve/hooks";

async function project(event: { type: string; data?: unknown }, ctx: { session: { id: string; turn: { id: string } } }) {
  await projectProductRunEventByReference({
    sessionId: ctx.session.id,
    runId: ctx.session.turn.id,
    event: { type: event.type, data: event.data },
  });
}

export default defineHook({
  events: {
    "turn.started": project,
    "step.started": project,
    "step.completed": project,
    "step.failed": project,
    "input.requested": project,
    "turn.completed": project,
    "turn.failed": project,
    "session.completed": project,
    "session.failed": project,
  },
});
