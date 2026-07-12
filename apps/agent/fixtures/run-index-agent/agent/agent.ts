import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  modelContextWindowTokens: 32_000,
  compaction: { modelContextWindowTokens: 32_000 },
  model: mockModel({
    modelId: "run-index-fixture",
    provider: "docs-agent-fixtures",
    respond: () => "The deterministic documentation check completed.",
  }),
});
