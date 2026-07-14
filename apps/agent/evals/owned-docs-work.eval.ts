import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const setup = `The working docs repository is https://github.com/peelar/saleor-docs.git at main with docs root docs and sandbox path /workspace/working-docs. Configure it if needed. Treat this as terminal-originated work and create a provider-neutral docs signal when substantial ownership is required.`;

export default [
  defineEval({
    description: "A quick documentation question completes inline",
    tags: ["owned-work", "inline"],
    async test(t) {
      await t.send("In one sentence, what is the difference between a guide and a reference page? Do not inspect a repository.");
      t.succeeded();
      t.notCalledTool("docs_work_read");
      t.notCalledTool("docs_work_manage");
    },
  }),
  defineEval({
    description: "Substantial work is accepted and continues in one durable turn",
    tags: ["owned-work", "substantial"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nTake ownership of documenting a new administrator migration workflow. Verify the current docs, choose the intervention, plan it, prepare the complete reversible draft, and validate it without waiting for another prompt. Do not publish.`);
      t.succeeded();
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "start"), count: 1 });
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "decide") });
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "plan") });
      t.calledTool("authoring_workspace");
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
  defineEval({
    description: "Missing evidence parks and later resumes the same owned work",
    tags: ["owned-work", "resume"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn the substantial docs work for a claimed public retry-limit change. Slack says the value is 12, but no release, source change, or product decision is available. Park visibly instead of writing.`);
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "start"), count: 1 });
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "park") });
      await t.send("The public release note now confirms the retry limit is 12 and links the merged change. Resume the same work and continue.");
      t.succeeded();
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "resume") });
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "start"), count: 1 });
    },
  }),
  defineEval({
    description: "A correction replans the existing draft",
    tags: ["owned-work", "correction"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn and draft a substantial standalone upgrade guide using verified evidence. Stop after the checked reversible draft; do not publish.`);
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "start"), count: 1 });
      await t.send("Correction: this must be consolidated into the canonical migration guide, not kept as a standalone page. Replan and revise the existing draft.");
      t.succeeded();
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "correct") });
      t.calledTool("docs_work_manage", { input: (input) => docsDecisionMode(input, "revise") });
      t.calledTool("docs_work_manage", { input: (input) => docsPlanMode(input, "revise") });
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "start"), count: 1 });
    },
  }),
  defineEval({
    description: "Routine execution does not spam the channel",
    tags: ["owned-work", "milestones"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn a substantial docs update, inspect the repository, make the reversible edits, run routine checks and report only meaningful milestones. Do not publish.`);
      t.succeeded();
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "milestone") && field(input, "activityKind") === "routine" });
      t.check(t.reply, satisfies((reply) => {
        const text = String(reply).toLowerCase();
        return !text.includes("i read file") && !text.includes("tool call") && !text.includes("retry 1");
      }, "final channel reply omits routine tool-by-tool narration"));
    },
  }),
  defineEval({
    description: "Publication remains approval-gated",
    tags: ["owned-work", "approval"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn this substantial documentation task through a checked draft. I have not approved publication or a draft pull request.`);
      t.succeeded();
      t.calledTool("docs_work_manage", { input: (input) => docsOperation(input, "milestone") && field(input, "milestone") === "approval-requested" });
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
  defineEval({
    description: "A bounded follow-up stays on the separate scheduling capability",
    tags: ["owned-work", "follow-up", "issue-84"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nCapture a small documentation review item, then schedule one follow-up for 2026-07-20T09:00:00.000Z with a short reason. Do not start substantial owned work, draft, or publish.`);
      t.succeeded();
      t.calledTool("docs_work_manage", {
        input: (input) => docsOperation(input, "create"),
        count: 1,
      });
      t.calledTool("docs_follow_up", { count: 1 });
      t.calledTool("docs_work_manage", {
        input: (input) => docsOperation(input, "start"),
        count: 0,
      });
      t.notCalledTool("authoring_workspace");
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
  defineEval({
    description: "A terminal no-change outcome finishes the original work",
    tags: ["owned-work", "terminal-outcome", "issue-84"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nCreate one signal for a substantial documentation investigation, take ownership, and record that verified current docs already cover the behavior. Finish the original work with the no-change outcome. Do not create a draft or publish.`);
      t.succeeded();
      t.calledTool("docs_work_manage", {
        input: (input) => docsOperation(input, "start"),
        count: 1,
      });
      t.calledTool("docs_work_manage", {
        input: (input) => docsOperation(input, "finish") && field(input, "outcome") === "no-change",
        count: 1,
      });
      t.notCalledTool("authoring_workspace");
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
];

function docsOperation(input: unknown, operation: string) { return isRecord(input) && input.operation === operation; }
function docsDecisionMode(input: unknown, mode: string) { return isRecord(input) && input.operation === "decide" && isRecord(input.decision) && input.decision.mode === mode; }
function docsPlanMode(input: unknown, mode: string) { return isRecord(input) && input.operation === "plan" && isRecord(input.plan) && input.plan.mode === mode; }
function field(input: unknown, name: string) { return isRecord(input) ? input[name] : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
