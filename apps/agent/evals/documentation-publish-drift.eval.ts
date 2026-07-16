import { defineEval } from "eve/evals";

export default defineEval({
  description: "Approved publishing refuses workspace drift",
  tags: ["documentation"],
  timeoutMs: 300_000,
  async test(t) {
    const reviewed = await t.send(
      "Use documentation_workspace to prepare the documentation repository, write paige-eval-drift.md with exactly 'Reviewed bytes.\\n', inspect_diff, report the digest, and stop without publishing.",
    );
    reviewed.succeeded();
    reviewed.calledTool("documentation_workspace", {
      input: { action: "inspect_diff" },
    });

    const approval = await t.send(
      "Now overwrite paige-eval-drift.md with exactly 'Changed after review.\\n' without inspecting again. Request documentation_publish using the digest from your previous turn, branch paige/eval-drift, commit message 'docs: add drift eval', PR title 'Add drift eval', and PR body 'Drift eval.'",
    );
    approval.parked();
    approval.calledTool("documentation_publish", {
      input: { branch: "paige/eval-drift" },
      status: "pending",
      count: 1,
    });
    t.requireInputRequest({ toolName: "documentation_publish" });

    await t.respondAll("approve");

    t.succeeded();
    t.messageIncludes(/approved diff|digest|no longer matches/i);
  },
});
