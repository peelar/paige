import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SlackEvent } from "@chat-adapter/slack";
import { LibSqlChatStateAdapter } from "@docs-agent/control-plane/agent";
import { migrateDocsAgentDatabase } from "@docs-agent/control-plane/testing";

import {
  redactSlackSearchSecrets,
  retrieveSlackContext,
  runWithSlackSearchRequest,
  runWithStagedSlackSearchRequest,
  stageSlackSearchRequest,
} from "../agent/lib/slack-context-retrieval";
import { test } from "vitest";

test("slack context retrieval", async () => {
const root = await mkdtemp(join(tmpdir(), "docs-agent-slack-search-"));
const databasePath = join(root, "search.sqlite");
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${databasePath}`;

const actionToken = "action-token-sensitive-value";
const rawSecret = "The confidential launch phrase is silver heron before customer preview begins";
const sourcePermalink = "https://example.slack.com/archives/C_OTHER/p1783808400000100";
const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
const activeAuth = {
  principalType: "user",
  attributes: { user_id: "U_REQUESTER" },
};

try {
  const success = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async (method, body) => {
      calls.push({ method, body });
      return {
        ok: true,
        results: {
          messages: [{
            content: rawSecret,
            permalink: sourcePermalink,
            context_messages: {
              before: [{ text: "The team compared two rollout paths." }],
              after: [{ text: "Source verification is still pending." }],
            },
          }],
        },
      };
    },
    async () => {
      const first = await retrieveSlackContext({
        query: "What did the launch team decide?",
        contextGap: "The current thread references a launch decision discussed elsewhere.",
        participantUserId: "UPARTICIPANT",
        limit: 3,
      }, activeAuth, {
        summarize: async () =>
          "The team compared rollout options and has not yet verified the decision against a source artifact [S1].",
      });
      const second = await retrieveSlackContext({
        query: "Try a second page",
        contextGap: "The first bounded search did not justify another automatic page.",
      }, activeAuth);
      return { first, second };
    },
  );

  assert.equal(success.first.status, "success");
  assert.equal(success.first.resultCount, 1);
  assert.deepEqual(success.first.sources, [{
    label: "Slack source 1",
    permalink: sourcePermalink,
  }]);
  assert.equal(success.second.status, "rate-limited");
  assert.equal(calls.length, 1, "one user turn allows one search request and no pagination");
  assert.equal(calls[0]?.method, "assistant.search.context");
  assert.equal(calls[0]?.body.action_token, actionToken);
  assert.equal(calls[0]?.body.limit, 3);
  assert.match(String(calls[0]?.body.query), /with:<@UPARTICIPANT>/u);
  assert.doesNotMatch(JSON.stringify(success.first), new RegExp(actionToken, "u"));
  assert.doesNotMatch(JSON.stringify(success.first), /confidential launch phrase/u);

  const copied = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async () => ({
      ok: true,
      results: { messages: [{ content: rawSecret, permalink: sourcePermalink }] },
    }),
    () => retrieveSlackContext({
      query: "launch phrase",
      contextGap: "The current turn needs the prior launch phrase discussion.",
    }, activeAuth, { summarize: async () => rawSecret }),
  );
  assert.match(copied.summary ?? "", /could not be safely reduced/u);
  assert.doesNotMatch(copied.summary ?? "", /silver heron/u);

  const noResults = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async () => ({ ok: true, results: { messages: [] } }),
    () => retrieveSlackContext({
      query: "missing discussion",
      contextGap: "The referenced discussion cannot be found in the current thread.",
    }, activeAuth, { summarize: async () => assert.fail("no results must not be summarized") }),
  );
  assert.equal(noResults.status, "no-results");

  const missingAuthorization = await retrieveSlackContext({
    query: "outside Slack",
    contextGap: "This call has no active user-triggered Slack request context.",
  }, activeAuth);
  assert.equal(missingAuthorization.status, "missing-authorization");

  const wrongUser = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async () => assert.fail("mismatched users must not reach Slack"),
    () => retrieveSlackContext({
      query: "private decision",
      contextGap: "The active principal does not match the Slack requester.",
    }, { principalType: "user", attributes: { user_id: "U_OTHER" } }),
  );
  assert.equal(wrongUser.status, "permission-denied");

  const publicPrivateSearch = await runWithSlackSearchRequest(
    event({ action_token: actionToken, channel_type: "channel" }),
    async () => assert.fail("a public-channel turn must not request private search"),
    () => retrieveSlackContext({
      query: "private decision",
      contextGap: "The user requested inaccessible private-channel context.",
      channelTypes: ["private_channel"],
    }, activeAuth),
  );
  assert.equal(publicPrivateSearch.status, "permission-denied");

  const missingScope = await runWithSlackSearchRequest(
    event({ action_token: actionToken, channel_type: "group" }),
    async () => ({ ok: false, error: "missing_scope" }),
    () => retrieveSlackContext({
      query: "private decision",
      contextGap: "The private discussion needs explicit Slack search access.",
      channelTypes: ["private_channel"],
    }, activeAuth),
  );
  assert.equal(missingScope.status, "missing-permission-or-consent");

  const slackRateLimit = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async () => { throw { data: { error: "ratelimited" } }; },
    () => retrieveSlackContext({
      query: "rate limited query",
      contextGap: "Slack refused the request under its interactive search limit.",
    }, activeAuth),
  );
  assert.equal(slackRateLimit.status, "rate-limited");

  const expired = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async () => ({ ok: false, error: "invalid_action_token" }),
    () => retrieveSlackContext({
      query: "expired token",
      contextGap: "The request-scoped Slack authorization has expired.",
    }, activeAuth),
  );
  assert.equal(expired.status, "missing-authorization");

  const reductionFailure = await runWithSlackSearchRequest(
    event({ action_token: actionToken }),
    async () => ({
      ok: true,
      results: { messages: [{ content: rawSecret, permalink: sourcePermalink }] },
    }),
    () => retrieveSlackContext({
      query: "failed reduction",
      contextGap: "Raw search results must be discarded if reduction fails.",
    }, activeAuth, { summarize: async () => { throw new Error(rawSecret); } }),
  );
  assert.equal(reductionFailure.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(reductionFailure), /silver heron/u);

  const stagedEvent = event({
    action_token: actionToken,
    ts: "1783808500.000300",
  });
  stageSlackSearchRequest(
    stagedEvent,
    async () => ({ ok: true, results: { messages: [] } }),
  );
  const staged = await runWithStagedSlackSearchRequest(
    ["latest-without-token", stagedEvent.ts!],
    "U_REQUESTER",
    () => retrieveSlackContext({
      query: "debounced mention",
      contextGap: "The action token came from an earlier message in the same burst.",
    }, activeAuth),
  );
  assert.equal(staged.status, "no-results");
  const consumed = await runWithStagedSlackSearchRequest(
    [stagedEvent.ts!],
    "U_REQUESTER",
    () => retrieveSlackContext({
      query: "consumed mention",
      contextGap: "A staged action token must be consumed only once.",
    }, activeAuth),
  );
  assert.equal(consumed.status, "missing-authorization");

  const sanitizedEvent = redactSlackSearchSecrets(event({ action_token: actionToken }));
  assert.doesNotMatch(JSON.stringify(sanitizedEvent), new RegExp(actionToken, "u"));

  await migrateDocsAgentDatabase();
  const state = new LibSqlChatStateAdapter();
  await state.connect();
  await state.set("slack-search-redaction-proof", {
    event: sanitizedEvent,
    toolResult: success.first,
  });
  await state.disconnect();
  const database = await readFile(databasePath);
  assert.equal(database.includes(Buffer.from(actionToken)), false);
  assert.equal(database.includes(Buffer.from(rawSecret)), false);
} finally {
  if (originalUrl === undefined) delete process.env.DOCS_AGENT_DATABASE_URL;
  else process.env.DOCS_AGENT_DATABASE_URL = originalUrl;
  await rm(root, { recursive: true, force: true });
}

console.log("Slack context retrieval checks passed.");

function event(
  overrides: Partial<SlackEvent> & { action_token?: string },
): SlackEvent {
  return {
    type: "app_mention",
    channel: "C_TRIGGER",
    channel_type: "channel",
    team_id: "T123",
    user: "U_REQUESTER",
    text: "@Paige find the missing context",
    ts: "1783808500.000200",
    ...overrides,
  };
}
});
