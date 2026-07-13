import { failApprovalsForRunReference, markApprovalAnsweredByCall, readPersistedSetupStatus, recordApprovalBatch } from "@docs-agent/control-plane/agent";
import { defineHook, type HookContext } from "eve/hooks";

export default defineHook({
  events: {
    async "input.requested"(event, ctx) {
      if (!event.data.requests.some((request) => request.display === "confirmation")) return;
      const continuationToken = ctx.channel.continuationToken;
      if (!continuationToken) throw new Error("Approval inbox cannot retain the Eve resume handle for this pending request.");
      const setup = await readPersistedSetupStatus();
      const destination = setup.state?.workingRepositoryInput?.workingDocumentationRepository.source.url;
      await recordApprovalBatch({
        sessionId: ctx.session.id,
        runId: ctx.session.turn.id,
        continuationToken,
        trigger: triggerFrom(ctx),
        requester: ctx.session.auth.current?.principalId ?? ctx.session.auth.initiator?.principalId ?? "unknown requester",
        destination,
        requests: [...event.data.requests],
      });
    },
    async "action.result"(event, ctx) {
      await markApprovalAnsweredByCall({ sessionId: ctx.session.id, runId: ctx.session.turn.id, callId: event.data.result.callId });
    },
    async "turn.failed"(_event, ctx) {
      await failApprovalsForRunReference({ sessionId: ctx.session.id, runId: ctx.session.turn.id });
    },
    async "session.failed"(_event, ctx) {
      await failApprovalsForRunReference({ sessionId: ctx.session.id, runId: ctx.session.turn.id });
    },
  },
});

function triggerFrom(ctx: HookContext) {
  if (ctx.channel.kind === "channel:slack") return "slack" as const;
  if (ctx.channel.kind === "channel:linear") return "linear" as const;
  if (ctx.channel.kind === "schedule") return "schedule" as const;
  if (ctx.channel.kind === "http") return "web" as const;
  return "other" as const;
}
