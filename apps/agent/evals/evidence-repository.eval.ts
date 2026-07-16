import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige discovers configured read-only evidence repositories",
  tags: ["evidence-repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use the evidence repository catalog and briefly list the configured evidence repositories.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("evidence_repository", {
      input: { action: "catalog" },
      output: (output) =>
        JSON.stringify(output).includes("saleor-dashboard") &&
        !JSON.stringify(output).includes("saleor-docs"),
    });
    t.messageIncludes("saleor-dashboard");
  },
});
