import { defineDynamic, defineTool } from "eve/tools";

import {
  docsWorkReadProviderInputSchema,
  projectDocsWorkModelOutput,
  readDocsWork,
} from "../lib/docs-work";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("docs_work_read")) return null;
  return defineTool({
  description: "Find bounded documentation work or inspect one work item and its provenance, events, artifacts, ownership, or current session decisions. This surface is read-only. Quick questions do not need durable work.",
  inputSchema: docsWorkReadProviderInputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("docs_work_read", ctx);
    return readDocsWork(input);
  },
  toModelOutput(output) {
    return { type: "json", value: projectDocsWorkModelOutput(output) };
  },
  });
} } });
