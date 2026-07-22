import assert from "node:assert/strict";

import { createClient } from "@libsql/client";
import type { AgentSessionError } from "@paige/sessions/errors";
import { AgentSessionService } from "@paige/sessions/service";
import { LibsqlAgentSessionStore } from "@paige/sessions/store";
import { agentSessionTitle } from "@paige/sessions/title";
import type { Result } from "neverthrow";
import { describe, test } from "vitest";

import {
  sessionSourceForChannel,
  statusForLifecycleEvent,
} from "../agent/hooks/session-index";
import { migrateTestDatabase } from "./database";
describe("agent session registry", () => {
  test("enriches an earlier lifecycle row without rolling status backward", async () => {
    const store = await createStore();
    unwrap(await store.updateLifecycle({
      sessionId: "ses_1",
      status: "running",
      occurredAt: "2026-07-17T08:00:00.000Z",
    }));
    unwrap(await store.updateLifecycle({
      sessionId: "ses_1",
      status: "waiting",
      occurredAt: "2026-07-17T08:01:00.000Z",
    }));

    assert.deepEqual(unwrap(await store.list()), []);

    const registered = await store.register({
      sessionId: "ses_1",
      source: "slack",
      firstMessage: "  Please   review the release notes.  ",
      registeredAt: "2026-07-17T08:02:00.000Z",
    });

    assert.deepEqual(unwrap(registered), {
      sessionId: "ses_1",
      source: "slack",
      title: "Please review the release notes.",
      status: "waiting",
      startedAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:01:00.000Z",
    });
  });

  test("keeps the first title and filters sources by recent activity", async () => {
    const store = await createStore();
    await store.register({
      sessionId: "ses_slack",
      source: "slack",
      firstMessage: "Slack title",
      registeredAt: "2026-07-17T08:00:00.000Z",
    });
    await store.register({
      sessionId: "ses_web",
      source: "local-web",
      firstMessage: "Local title",
      registeredAt: "2026-07-17T09:00:00.000Z",
    });
    await store.register({
      sessionId: "ses_web",
      source: "local-web",
      firstMessage: "Replacement title",
      registeredAt: "2026-07-17T10:00:00.000Z",
    });

    assert.deepEqual(
      unwrap(await store.list()).map(({ sessionId }) => sessionId),
      ["ses_web", "ses_slack"],
    );
    assert.deepEqual(
      unwrap(await store.list({ source: "slack" })).map(({ sessionId }) =>
        sessionId
      ),
      ["ses_slack"],
    );
    assert.equal(unwrap(await store.get("ses_web"))?.title, "Local title");
  });
});

describe("agent session lifecycle", () => {
  test("uses session boundaries for terminal status", () => {
    assert.equal(statusForLifecycleEvent("session.started"), "running");
    assert.equal(statusForLifecycleEvent("turn.started"), "running");
    assert.equal(statusForLifecycleEvent("turn.completed"), undefined);
    assert.equal(statusForLifecycleEvent("turn.failed"), undefined);
    assert.equal(statusForLifecycleEvent("session.waiting"), "waiting");
    assert.equal(statusForLifecycleEvent("session.completed"), "completed");
    assert.equal(statusForLifecycleEvent("session.failed"), "failed");
  });

  test("indexes the authored Slack channel and ignores other channels", () => {
    assert.equal(sessionSourceForChannel("channel:slack"), "slack");
    assert.equal(sessionSourceForChannel("chat-sdk"), undefined);
    assert.equal(sessionSourceForChannel("http"), undefined);
    assert.equal(sessionSourceForChannel(undefined), undefined);
  });
});

test("session titles stay compact", () => {
  assert.equal(agentSessionTitle("\n\t"), "Untitled session");
  assert.equal(agentSessionTitle("word ".repeat(30)).length, 80);
  assert.equal(
    agentSessionTitle(
      "hi @U0BHTLLK4EL, what’s your favorite soup?",
      "slack",
    ),
    "hi @Paige, what’s your favorite soup?",
  );
});

async function createStore(): Promise<AgentSessionService> {
  const client = createClient({ url: ":memory:" });
  await migrateTestDatabase(client);
  return new AgentSessionService(
    new LibsqlAgentSessionStore(client),
  );
}

function unwrap<T>(result: Result<T, AgentSessionError>): T {
  if (result.isErr()) throw result.error;
  return result.value;
}
