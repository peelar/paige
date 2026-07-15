import { cancelDocsFollowUp, createDocsFollowUp, createDocsFollowUpInputSchema, docsFollowUpSchema, docsFollowUpStatusSchema, getLatestDocsFollowUpRun, listDocsFollowUps, docsFollowUpRunSchema } from "@docs-agent/control-plane/agent";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

const createInputSchema = createDocsFollowUpInputSchema.extend({ mode: z.literal("create") });
const listInputSchema = z.object({
  mode: z.literal("list"),
  status: docsFollowUpStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
const cancelInputSchema = z.object({
  mode: z.literal("cancel"),
  id: z.string().trim().min(1),
  reason: createDocsFollowUpInputSchema.shape.reason,
});
const scheduleStatusInputSchema = z.object({ mode: z.literal("schedule-status") });

const docsFollowUpModeInputSchema = z.discriminatedUnion("mode", [
  createInputSchema,
  listInputSchema,
  cancelInputSchema,
  scheduleStatusInputSchema,
]);

export const docsFollowUpInputSchema = z.object({
  mode: z.enum(["create", "list", "cancel", "schedule-status"]),
  signalId: createDocsFollowUpInputSchema.shape.signalId.optional(),
  reason: cancelInputSchema.shape.reason.optional(),
  dueAt: createDocsFollowUpInputSchema.shape.dueAt.optional(),
  status: listInputSchema.shape.status.optional(),
  limit: listInputSchema.shape.limit.removeDefault().optional(),
  id: cancelInputSchema.shape.id.optional(),
}).strict().pipe(docsFollowUpModeInputSchema);
const outputSchema = z.union([
  z.object({ mode: z.literal("create"), followUp: docsFollowUpSchema }),
  z.object({ mode: z.literal("list"), followUps: z.array(docsFollowUpSchema) }),
  z.object({ mode: z.literal("cancel"), followUp: docsFollowUpSchema }),
  z.object({ mode: z.literal("schedule-status"), lastRun: docsFollowUpRunSchema.nullable() }),
]);

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("docs_follow_up")) return null;
  return defineTool({
  description: "Manage the small docs follow-up checklist on existing docs signals. Store a due time and short reason, list or cancel pending items, or inspect the last visible daily schedule run. This does not publish documentation.",
  inputSchema: docsFollowUpInputSchema,
  outputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("docs_follow_up", ctx);
    switch (input.mode) {
      case "create": return { mode: "create" as const, followUp: await createDocsFollowUp(input) };
      case "list": return { mode: "list" as const, followUps: await listDocsFollowUps(input) };
      case "cancel": return { mode: "cancel" as const, followUp: await cancelDocsFollowUp(input) };
      case "schedule-status": return { mode: "schedule-status" as const, lastRun: await getLatestDocsFollowUpRun() };
    }
  },
  });
} } });
