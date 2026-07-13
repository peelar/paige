import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const RELEASE_URL = "https://github.com/saleor/saleor/releases/tag/3.23.9";
const PULL_REQUEST_URL = "https://github.com/saleor/saleor/pull/19281";
const PACKAGE_URL = "https://www.npmjs.com/package/@editorjs/table";

export default defineEval({
  description: "Documentation impact reports link available evidence sources",
  tags: ["identity", "evidence", "markdown-links", "slack"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "Reply without tools with a concise documentation impact report.",
      "The verified finding is that Saleor 3.23.9 added @editorjs/table support, but the 3.22-to-3.23 upgrade guide does not list it.",
      `Release notes: ${RELEASE_URL}`,
      `Merged implementation PR: ${PULL_REQUEST_URL}`,
      `EditorJS table package: ${PACKAGE_URL}`,
      "Mention all three sources as evidence, then say the smallest patch is to add the package to the supported-extension list.",
    ].join("\n"));

    t.succeeded();
    t.usedNoTools();
    t.check(
      t.reply,
      satisfies(
        (reply) => [RELEASE_URL, PULL_REQUEST_URL, PACKAGE_URL]
          .every((url) => hasDescriptiveMarkdownLink(String(reply), url)),
        "every available evidence URL is presented as a descriptive Markdown link",
      ),
    );
  },
});

function hasDescriptiveMarkdownLink(value: string, url: string): boolean {
  return value.includes(`](${url})`) && !value.includes(`[${url}](${url})`);
}
