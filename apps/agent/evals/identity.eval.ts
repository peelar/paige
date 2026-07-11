import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const evalDataDir = mkdtempSync(join(tmpdir(), "paige-identity-evals-"));
process.env.DOCS_AGENT_DATABASE_URL ??= `file:${join(evalDataDir, "docs-agent.sqlite")}`;

export default [
  defineEval({
    description: "Paige responds naturally to a bare Slack mention",
    tags: ["identity", "conversation", "slack"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send("<@U0BGMUJFKJM>");

      t.succeeded();
      t.usedNoTools();
      t.check(
        t.reply,
        satisfies(
          (reply) => matchesBareMentionReply(reply),
          "bare mention gets a short invitation to continue without provider or workflow language",
        ),
      );
    },
  }),
  defineEval({
    description: "Paige lets a person finish an incomplete thought",
    tags: ["identity", "conversation"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send("Hey! I was looking at the authentication docs and...");

      t.succeeded();
      t.usedNoTools();
      t.check(
        t.reply,
        satisfies(
          (reply) => matchesIncompleteThoughtReply(reply),
          "incomplete thought gets a concise conversational invitation instead of setup intake",
        ),
      );
    },
  }),
];

function matchesBareMentionReply(reply: unknown): boolean {
  const text = String(reply).trim();
  const lower = text.toLowerCase();

  return text.length > 0 &&
    text.length <= 120 &&
    text.includes("?") &&
    !text.includes("\n") &&
    !text.includes("<@") &&
    !/\bU[A-Z0-9]{8,}\b/.test(text) &&
    !/\p{Extended_Pictographic}/u.test(text) &&
    !includesAny(lower, [
      "i'm paige",
      "i am paige",
      "i can help",
      "only contains a mention",
      "no additional context",
      "documentation-related content",
      "docs concern",
      "working documentation repository",
      "setup",
    ]);
}

function matchesIncompleteThoughtReply(reply: unknown): boolean {
  const text = String(reply).trim();
  const lower = text.toLowerCase();

  return text.length > 0 &&
    text.length <= 320 &&
    (text.includes("?") || includesAny(lower, ["go on", "keep going", "tell me more"])) &&
    !includesAny(lower, [
      "repository url",
      "working documentation repository",
      "setup mode",
      "fully formed task",
      "documentation-related content",
    ]);
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
