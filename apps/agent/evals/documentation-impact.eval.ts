import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const pullRequestUrl = "https://github.com/saleor/saleor/pull/19450";
const documentationUrl = "https://docs.saleor.io/developer/stock/overview";

export default defineEval({
  description:
    "Paige leads documentation-impact assessments with a human answer and linked evidence",
  tags: ["documentation", "identity", "markdown-links"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "Assess whether this pull request needs documentation.",
      "Use the verified evidence below; do not inspect repositories or edit anything.",
      `Pull request: ${pullRequestUrl}`,
      "The pull request makes the existing PRODUCT_VARIANT_STOCK_UPDATED webhook fire when order creation, cancellation, fulfillment, or returns change stock.",
      "It adds no API, event type, migration, or configuration.",
      `Current stock overview: ${documentationUrl}`,
      'The overview says: "Triggered whenever a product variant\'s stock quantity changes."',
      "An optional clarification could list direct stock edits and order activity as trigger sources.",
      "Give the decision first, then a useful explanation and supporting detail.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("assess-documentation-impact");
    t.notCalledTool("pull_request_read");
    t.notCalledTool("repository_read");
    t.notCalledTool("documentation_workspace");
    t.notCalledTool("documentation_publish");
    t.check(
      t.reply,
      satisfies((reply) => {
        const value = String(reply);
        const wordCount = value.trim().split(/\s+/u).length;
        return wordCount <= 140 &&
          hasDescriptiveMarkdownLink(value, pullRequestUrl) &&
          hasDescriptiveMarkdownLink(value, documentationUrl) &&
          /no (documentation|docs) change (is )?(needed|required)/i.test(value) &&
          /optional/i.test(value) &&
          !/tl;dr/iu.test(value) &&
          !/(in plain english|simply put|in simple terms)/i.test(value) &&
          !/\n\|.+\|\n\|[-:| ]+\|/.test(value) &&
          !/^#{1,6} bottom line/im.test(value);
      }, "the reply is answer-first, linked, natural, and avoids report-like repetition"),
    );
  },
});

function hasDescriptiveMarkdownLink(value: string, url: string): boolean {
  return value.includes(`](${url})`) && !value.includes(`[${url}](${url})`);
}
