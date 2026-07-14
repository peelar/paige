import { docsFollowUpRunSchema, processDueDocsFollowUps } from "@docs-agent/control-plane/agent";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({
  events: {
    "step.started": async (event, context) => {
      if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("process_due_docs_followups")) return null;
      return defineTool({
        description: "Claim and record the bounded set of docs follow-ups due in the current UTC daily occurrence. Call exactly once from the daily follow-up schedule. Replays return the existing run. Investigate returned signals through the normal evidence-first workflow; never publish from scheduled work.",
        inputSchema: z.object({}),
        outputSchema: z.object({ replayed: z.boolean(), run: docsFollowUpRunSchema.nullable(), due: z.array(z.object({ followUpId: z.string(), signalId: z.string(), reason: z.string() })) }),
        async execute(_input, ctx) {
          await requireCapabilityToolExecution("process_due_docs_followups", ctx);
          return processDueDocsFollowUps();
        },
      });
    },
  },
});
