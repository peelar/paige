import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige lists and searches a configured evidence repository",
  tags: ["evidence-repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use evidence_repository list_files to find README.md in saleor-dashboard, then use evidence_repository search to find the phrase 'Saleor Dashboard' in that repository. Briefly report the matching path.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("evidence_repository", {
      input: { action: "list_files", repositoryId: "saleor-dashboard" },
    });
    t.calledTool("evidence_repository", {
      input: {
        action: "search",
        repositoryId: "saleor-dashboard",
        query: "Saleor Dashboard",
      },
      output: (output) => JSON.stringify(output).includes("README.md"),
    });
    t.messageIncludes("README.md");
  },
});
