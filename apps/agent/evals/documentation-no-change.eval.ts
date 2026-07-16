import { defineEval } from "eve/evals";

export default defineEval({
  description: "Paige reports an unchanged documentation workspace",
  tags: ["documentation"],
  timeoutMs: 240_000,
  async test(t) {
    await t.send(
      "Use documentation_workspace to prepare the documentation repository and immediately inspect_diff without editing anything. Briefly report the no-change result. Do not publish.",
    );
    t.succeeded();
    t.noFailedActions();
    t.calledTool("documentation_workspace", {
      input: { action: "prepare" },
    });
    t.calledTool("documentation_workspace", {
      input: { action: "inspect_diff" },
      output: (output) =>
        JSON.stringify(output).includes('"hasChanges":false') &&
        JSON.stringify(output).includes('"changedFiles":[]'),
    });
    t.notCalledTool("documentation_publish");
  },
});
