import { defineEval } from "eve/evals";

const repositorySetup = `
The working documentation repository is https://github.com/peelar/saleor-docs.git at ref main,
with docs root docs and sandbox path /workspace/working-docs. Configure it if this eval
session does not already have setup. The docs-impact decision and current-docs verification
are complete. Use the supplied verified repository evidence and docs-profile observations.
Record and briefly explain the editorial recommendation. For substantial work, also create
the content plan, then stop before drafting because this eval isolates editorial judgment.
`;

const cases = [
  {
    title: "Reject a requested duplicate page",
    intervention: "focused-patch",
    requiresPlan: false,
    prompt: `A maintainer requested a new "Webhook retries" page. Verified repository evidence shows docs/developer/extending/apps/webhooks.mdx is the canonical webhook task guide and already owns retry behavior; only the retry timing sentence is missing. The docs profile says task variants stay on the canonical guide. Explain the duplication risk and choose the better intervention.`,
  },
  {
    title: "Patch a small canonical-page gap",
    intervention: "focused-patch",
    requiresPlan: false,
    prompt: `A verified release adds one optional field to an existing webhook payload. The canonical webhook page already explains the payload and has the matching example; one field description is missing. The maintainer prefers the existing heading style. Make the narrow reader-solving choice without debating that routine style preference.`,
  },
  {
    title: "Consolidate fragmented obsolete content",
    intervention: "consolidate",
    requiresPlan: true,
    prompt: `Verified docs contain three authentication pages with conflicting token-lifetime guidance. The docs profile identifies one canonical authentication guide; two older pages are unlinked and obsolete. Readers currently encounter contradictions. Choose an intervention that removes fragmentation rather than adding another patch.`,
  },
  {
    title: "Create a document for a distinct reader task",
    intervention: "new-document",
    requiresPlan: true,
    prompt: `Verified docs explain API authentication for app developers but contain no operational migration procedure for administrators rotating production credentials across environments. Repository navigation has a migration-guides section and nearby examples. This is a distinct reader and task, not a variant of the API reference.`,
  },
  {
    title: "Follow a reaffirmed maintainer intervention",
    intervention: "new-document",
    requiresPlan: true,
    reaffirmed: true,
    prompt: `You previously explained that updating the canonical integration guide would avoid a second page. After reviewing that tradeoff, the maintainer explicitly reaffirmed a new document because support teams need a standalone printable runbook. Evidence supports every public claim and no safety boundary is crossed. Follow the reaffirmed choice.`,
  },
  {
    title: "Wait when public behavior lacks evidence",
    intervention: "wait-for-evidence",
    requiresPlan: false,
    prompt: `A Slack message claims the public retry limit changed, but verified current docs still show the old value and there is no release, source change, product decision, or maintainer confirmation. Writing the new value would be an unsupported public claim. Pause for the missing evidence.`,
  },
] as const;

export default cases.map((scenario) => defineEval({
  description: scenario.title,
  tags: ["editorial-judgment", scenario.intervention],
  timeoutMs: 900_000,
  async test(t) {
    await t.send(`${repositorySetup}\n\n${scenario.prompt}`);
    t.succeeded();
    t.noFailedActions();
    t.calledTool("editorial_recommendation", {
      input: (input) => isRecord(input) &&
        input.mode === "create" &&
        input.chosenIntervention === scenario.intervention &&
        Array.isArray(input.repositoryEvidence) && input.repositoryEvidence.length > 0 &&
        Array.isArray(input.alternatives) && input.alternatives.length <= 3 &&
        ("reaffirmed" in scenario
          ? isRecord(input.maintainerDirection) && input.maintainerDirection.reaffirmed === true
          : true),
      count: 1,
    });
    if (scenario.requiresPlan) t.calledTool("content_plan", { count: 1 });
    else t.notCalledTool("content_plan");
    if (scenario.intervention === "wait-for-evidence") {
      t.notCalledTool("authoring_workspace");
    }
    t.notCalledTool("publish_working_repository_pr");
  },
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
