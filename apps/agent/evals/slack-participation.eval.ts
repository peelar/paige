import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import {
  SLACK_DIRECT_ONLY_THREAD_POLICY,
  SLACK_FOLLOWED_THREAD_POLICY,
  SLACK_SILENT_REPLY,
} from "../agent/lib/slack-chat-turn";

// Preserve the workspace package boundary when Eve bundles eval definitions.
const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
let controlPlaneTestingPromise:
  | Promise<typeof import("@docs-agent/control-plane/testing")>
  | undefined;
const { migrateDocsAgentDatabase } = await controlPlaneTesting();
const evalDataDir = mkdtempSync(join(tmpdir(), "docs-agent-slack-participation-evals-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(evalDataDir, "docs-agent.sqlite")}`;
await migrateDocsAgentDatabase();

export default [
  defineEval({
    description: "A direct follow-up in an enrolled Slack thread gets a normal response",
    tags: ["slack-participation", "continuation", "respond"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send(followedThreadPrompt(
        "Paige just offered to help with documentation evidence. The next human message says: Great — what evidence would you need before documenting a new API limit?",
      ));
      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies((reply) => usefulReply(reply, ["evidence", "source", "release"]), "direct continuation gets a useful answer"));
    },
  }),
  defineEval({
    description: "An unaddressed answerable docs question in an enrolled thread gets an answer",
    tags: ["slack-participation", "answerable-question", "respond"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send(followedThreadPrompt(
        "Nobody names Paige. A human asks the room: Should documentation for a permission-gated GraphQL field state which permission is required?",
      ));
      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies((reply) => usefulReply(reply, ["permission", "docs", "document"]), "answerable documentation question gets a response"));
    },
  }),
  defineEval({
    description: "Unrelated chatter in an enrolled Slack thread stays silent",
    tags: ["slack-participation", "unrelated", "silent"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send(followedThreadPrompt(
        "The latest messages are coworkers choosing lunch: I can order pierogi. Should we get six portions or eight? This has no documentation, product, API, release, or support relevance.",
      ));
      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies((reply) => String(reply).trim() === SLACK_SILENT_REPLY, "unrelated chatter emits the channel's silent marker"));
    },
  }),
  defineEval({
    description: "Relevant followed-thread context becomes a docs signal without forcing a reply",
    tags: ["slack-participation", "docs-signal", "capture"],
    timeoutMs: 300_000,
    metadata: { expectedTools: ["capture_slack_docs_signal"] },
    async test(t) {
      await t.send(relevantSignalPrompt());
      t.succeeded();
      t.noFailedActions();
      t.calledTool("capture_slack_docs_signal", {
        count: 1,
        input: (input) => isRecord(input) &&
          input.channelId === "C_FOLLOWED" &&
          input.threadTs === "1783808400.000100" &&
          input.publicDocsImpact === "substantive",
      });
    },
  }),
  defineEval({
    description: "Direct-only followed-thread variant ignores an unaddressed room question",
    tags: ["slack-participation", "variant", "direct-only", "silent"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send([
        SLACK_DIRECT_ONLY_THREAD_POLICY,
        "Treat this as one accepted observer turn from an already-enrolled Slack thread.",
        "Nobody addresses Paige or continues her last exchange. A human asks the room whether a permission-gated field should be documented.",
      ].join("\n\n"));

      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies(
        (reply) => String(reply).trim() === SLACK_SILENT_REPLY,
        "direct-only continuation stays silent when Paige was not engaged",
      ));
    },
  }),
];

function followedThreadPrompt(latestContext: string): string {
  return [
    SLACK_FOLLOWED_THREAD_POLICY,
    "Treat this as one accepted observer turn from an already-enrolled Slack thread.",
    latestContext,
    `If silence is correct, output exactly ${SLACK_SILENT_REPLY}.`,
  ].join("\n\n");
}

function relevantSignalPrompt(): string {
  return followedThreadPrompt([
    "A followed Slack thread contains a plausible public API documentation concern. Capture it with capture_slack_docs_signal.",
    "Use exactly this context:",
    "- teamId: T_FOLLOWED",
    "- channelId: C_FOLLOWED",
    "- channelName: api-release",
    "- threadTs: 1783808400.000100",
    "- triggeringMessageTs: 1783808460.000200",
    "- permalink: https://example.slack.com/archives/C_FOLLOWED/p1783808400000100",
    "- messages: U_ENGINEER at 1783808400.000100 says the next public release adds permission-gated private metadata filtering; U_SUPPORT at 1783808460.000200 says customers are already asking how it works.",
    "- sourceSummary: A followed Slack thread reports a public permission-gated metadata filtering change that may need docs.",
    "- extractedClaims: Private metadata filtering will be available to users with the required permission.",
    "- likelyDocsConcepts: metadata filtering",
    "- likelyDocsPages: docs/api-usage/metadata.mdx",
    "- productSurfaces: GraphQL API",
    "- publicDocsImpact: substantive",
    "- sourceEvidence: missing",
    "- currentDocsState: not-run",
    "- missingEvidence: A source change or release note confirming the public behavior.",
    "Do not configure a repository, verify docs, prepare a patch, publish, or call any other tool.",
  ].join("\n"));
}

function usefulReply(reply: unknown, terms: string[]): boolean {
  const text = String(reply).trim().toLowerCase();
  return text.length > 0 &&
    text !== SLACK_SILENT_REPLY.toLowerCase() &&
    terms.some((term) => text.includes(term));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function controlPlaneTesting() {
  controlPlaneTestingPromise ??= import(controlPlaneTestingModule);
  return controlPlaneTestingPromise;
}
