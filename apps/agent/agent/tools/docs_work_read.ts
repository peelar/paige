import { defineTool } from "eve/tools";

import {
  docsWorkReadInputSchema,
  projectDocsWorkModelOutput,
  readDocsWork,
} from "../lib/docs-work";

export default defineTool({
  description: "Find bounded documentation work or inspect one work item and its provenance, events, artifacts, ownership, or current session decisions. This surface is read-only. Quick questions do not need durable work.",
  inputSchema: docsWorkReadInputSchema,
  execute: readDocsWork,
  toModelOutput(output) {
    return { type: "json", value: projectDocsWorkModelOutput(output) };
  },
});
