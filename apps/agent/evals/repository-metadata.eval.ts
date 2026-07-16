import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige reads bounded GitHub repository metadata",
  tags: ["repository"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send(
      "Use repository_metadata to list the three most recent tags for saleor-dashboard. Briefly report the tag names.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("repository_metadata", {
      input: {
        action: "list_tags",
        repositoryId: "saleor-dashboard",
        limit: 3,
      },
      output: (output) =>
        JSON.stringify(output).includes('"tags"') &&
        JSON.stringify(output).includes('"commitSha"'),
    });
  },
});
