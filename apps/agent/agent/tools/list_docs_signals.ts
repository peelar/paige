import { defineTool } from "eve/tools";

import {
  listDocsSignals,
  listDocsSignalsInputSchema,
  listDocsSignalsResultSchema,
} from "../lib/docs-signals.js";

export default defineTool({
  description:
    "List docs signals by lifecycle status and source kind. Defaults to open signals only.",
  inputSchema: listDocsSignalsInputSchema,
  outputSchema: listDocsSignalsResultSchema,
  execute: listDocsSignals,
});
