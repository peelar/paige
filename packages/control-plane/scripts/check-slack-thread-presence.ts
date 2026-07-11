import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../src/db/client.js";
import {
  continueSlackThreadPresence,
  endSlackThreadPresence,
  enrollSlackThreadPresence,
  resolveSlackThreadPresenceForSignal,
} from "../src/slack-thread-presence.js";

const root = await mkdtemp(join(tmpdir(), "docs-agent-slack-presence-"));
const originalUrl = process.env.DOCS_AGENT_DATABASE_URL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "presence.sqlite")}`;

try {
  await migrateDocsAgentDatabase();
  const base = {
    teamId: "T123",
    channelId: "C123",
    threadTs: "100.000",
    chatThreadId: "slack:C123:100.000",
    continuationToken: "slack:C123:100.000",
    inviterUserId: "U_INVITER",
    nowMs: 1_000,
    ttlMs: 100,
  };
  const enrolled = await enrollSlackThreadPresence(base);
  assert.equal(enrolled.status, "active");
  assert.equal(enrolled.continuationToken, base.continuationToken);
  assert.equal((await continueSlackThreadPresence({ chatThreadId: base.chatThreadId, nowMs: 1_050, ttlMs: 100 })).admitted, true);
  const expired = await continueSlackThreadPresence({ chatThreadId: base.chatThreadId, nowMs: 1_151, ttlMs: 100 });
  assert.equal(expired.admitted, false);
  assert.equal(expired.presence?.status, "expired");

  await enrollSlackThreadPresence({ ...base, nowMs: 2_000 });
  const dismissed = await endSlackThreadPresence({ chatThreadId: base.chatThreadId, status: "dismissed", reason: "explicit-dismissal", nowMs: 2_010 });
  assert.equal(dismissed?.status, "dismissed");
  assert.equal((await continueSlackThreadPresence({ chatThreadId: base.chatThreadId, nowMs: 2_020 })).admitted, false);

  await enrollSlackThreadPresence({ ...base, nowMs: 3_000 });
  const resolved = await resolveSlackThreadPresenceForSignal({ channelId: base.channelId, threadTs: base.threadTs, signalId: "signal-1", nowMs: 3_010 });
  assert.equal(resolved?.status, "resolved");
  assert.match(resolved?.endReason ?? "", /signal-1/);

  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => enrollSlackThreadPresence({ ...base, inviterUserId: `U${index}`, nowMs: 4_000 + index })));
  assert.equal(new Set(concurrent.map(({ id }) => id)).size, 1, "concurrent enrollment keeps one presence record");
} finally {
  if (originalUrl === undefined) delete process.env.DOCS_AGENT_DATABASE_URL;
  else process.env.DOCS_AGENT_DATABASE_URL = originalUrl;
  await rm(root, { recursive: true, force: true });
}

console.log("Slack thread presence checks passed.");
