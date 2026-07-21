import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const upgradeGuideUrl =
  "https://docs.saleor.io/upgrade-guides/core/3-22-to-3-23";
const changelogUrl =
  "https://github.com/saleor/saleor/blob/3.23/CHANGELOG.md";

export default defineEval({
  description:
    "Paige keeps an exhaustive upgrade-guide assessment concise while preserving decisive evidence",
  tags: ["documentation", "identity", "brevity"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "yo @Paige can you check if upgrade guide on the latest saleor version are exhaustive",
      "Use the verified evidence below; do not inspect repositories or edit anything.",
      `Upgrade guide: ${upgradeGuideUrl}`,
      `Saleor 3.23 changelog: ${changelogUrl}`,
      "The guide covers all 13 breaking changes in the changelog.",
      "It misses two integration-relevant webhook behavior changes: order sync webhooks are no longer pre-fired before async events, and order webhook payloads now build in background tasks.",
      "It also misses two observability deprecations scheduled for removal in 3.24 and one minor createsuperuser change affecting custom User models.",
      "The guide contains three useful migration items not present in the changelog.",
      "Answer the user's original question. Treat exhaustive as the scope of the investigation, not a request for an exhaustive response.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.notCalledTool("pull_request_read");
    t.notCalledTool("repository_read");
    t.check(
      t.reply,
      satisfies((reply) => {
        const value = String(reply);
        const wordCount = value.trim().split(/\s+/u).length;
        const bulletCount = value.match(/^\s*[-*]\s/gmu)?.length ?? 0;
        return wordCount <= 120 &&
          bulletCount <= 2 &&
          /not (fully|quite)|mostly|gap|miss/i.test(value) &&
          /webhook/i.test(value) &&
          hasDescriptiveMarkdownLink(value, upgradeGuideUrl) &&
          hasDescriptiveMarkdownLink(value, changelogUrl) &&
          !/here(?:'s| is) (?:the|a) breakdown/iu.test(value) &&
          !/if you(?:'d| would) like|(?:want|would you like) me to/iu.test(value) &&
          !/\n\|.+\|\n\|[-:| ]+\|/u.test(value) &&
          !/^#{1,6} (bottom line|summary|what's well covered)/imu.test(value);
      }, "the complete answer is concise, decisive, linked, and free of report-like structure"),
    );
  },
});

function hasDescriptiveMarkdownLink(value: string, url: string): boolean {
  return value.includes(`](${url})`) && !value.includes(`[${url}](${url})`);
}
