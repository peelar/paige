import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { pendingSlackReport, reportFilename } from "../../slack/report";

export const shareReportInputSchema = z.object({
  answer: z.string().min(1).max(2_000).refine(
    (value) => value.trim().split(/\s+/u).length <= 80,
    "The standalone Slack answer must contain no more than 80 words.",
  ).describe(
    "The concise standalone Slack answer, including the conclusion, critical caveats, required actions, and compact source links. Maximum 80 words.",
  ),
  markdown: z.string().min(1).max(200_000).describe(
    "The complete self-contained Markdown report, beginning with a descriptive H1 heading.",
  ),
  title: z.string().min(1).max(120).describe(
    "A short descriptive report title used to name the attachment.",
  ),
}).strict();

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      if (ctx.channel.kind !== "channel:slack") return null;

      return defineTool({
        description:
          "Attach an optional Markdown report to the final Slack answer when research produced substantial reusable evidence that would overwhelm the concise reply. Do not use for ordinary answers. Keep the final reply independently useful and put only extended evidence, methodology, or exhaustive inventories in the report.",
        inputSchema: shareReportInputSchema,
        async execute(input, toolContext) {
          await pendingSlackReport.update(() => ({
            answer: input.answer,
            markdown: input.markdown,
            title: input.title,
            turnSequence: toolContext.session.turn.sequence,
          }));
          return {
            filename: reportFilename(input.title),
            status: "queued",
          };
        },
        toModelOutput(output) {
          return {
            type: "text",
            value:
              `The concise answer and optional report ${output.filename} are queued for the final Slack message. Reply with a minimal completion; the channel will deliver the queued answer without repeating your completion text.`,
          };
        },
      });
    },
  },
});
