import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige reads a configured evidence repository",
  tags: ["evidence-repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the evidence_repository tool to read the first five lines of README.md from saleor-dashboard. Briefly confirm the file was readable.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("evidence_repository", {
      input: { action: "read", repositoryId: "saleor-dashboard", path: "README.md" },
    });
  },
});
