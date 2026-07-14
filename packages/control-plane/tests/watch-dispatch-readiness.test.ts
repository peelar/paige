import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  docsFollowUps,
  docsSignals,
  watchDispatchReservations,
  watchProcessingBudgetBuckets,
  workspaceMemoryRecords,
} from "../src/db/schema.ts";
import {
  approveWatchProposal,
  createProposedWatch,
  editWatchProposal,
} from "../src/policy-bound-watches.ts";
import { DEFAULT_WORKSPACE_ID } from "../src/setup-state.ts";
import type {
  ActivePolicyBoundWatch,
  ProposedWatchPolicy,
} from "../src/watch-contract.ts";
import {
  prepareWatchDispatch,
  resolveWatchDispatchCapabilityAuthority,
  WatchDispatchReadinessError,
} from "../src/watch-dispatch-readiness.ts";
import { claimWatchObservation } from "../src/watch-observation-claims.ts";
import { createEphemeralWatchObservation } from "../src/watch-observation.ts";
import { assembleClaimedWatchObservation } from "../src/watch-observation-windows.ts";
import { mutateWatchLifecycle } from "../src/watch-lifecycle.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_CAPABILITY_REGISTRY,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-13T22:00:00.000Z");
const OPERATOR = { id: "operator-75", githubLogin: "docs-owner" };

test("dispatch readiness returns exact approved authority and idempotently reserves hourly budget", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      budgets: {
        observationsPerHour: 60,
        processingRunsPerHour: 1,
        deliveriesPerDay: 0,
        inputCharactersPerHour: 120_000,
      },
    }));
    const first = await createHandoff(active, "first bounded dispatch", "501");
    const before = await sideEffectCounts();
    const ready = await prepareWatchDispatch(first, readinessContext(NOW));
    assert.equal(ready.reservation.replayed, false);
    assert.deepEqual(
      ready.effectiveRevision.policy.capabilityGrants,
      ["knowledge.read"],
    );
    assert.equal(ready.effectiveRevision.id, active.effectiveRevision.id);
    assert.deepEqual(ready.handoff, first);
    assert.deepEqual(await sideEffectCounts(), before);

    const replay = await prepareWatchDispatch(
      first,
      readinessContext(new Date("2026-07-13T22:10:00.000Z")),
    );
    assert.equal(replay.reservation.replayed, true);
    assert.equal(replay.reservation.id, ready.reservation.id);

    const second = await createHandoff(active, "second over budget", "502");
    await assert.rejects(
      () => prepareWatchDispatch(second, readinessContext(NOW)),
      errorWithCode("budget-exhausted"),
    );
    const reservations = await withDocsAgentDatabase((db) =>
      db.select().from(watchDispatchReservations)
    );
    const buckets = await withDocsAgentDatabase((db) =>
      db.select().from(watchProcessingBudgetBuckets)
    );
    assert.equal(reservations.length, 1, "failed budget reservation rolls back");
    assert.equal(buckets[0]?.reservedRuns, 1);
    assert.doesNotMatch(
      JSON.stringify({ reservations, buckets }),
      /first bounded dispatch|second over budget|U-PRIVATE|xoxb/u,
    );
    assert.doesNotMatch(
      JSON.stringify(ready),
      /team_id|bot_id|rawPayload|subtype/u,
    );
  });
});

test("capability resolution re-reads the ready reservation and current exact watch authority", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      source: source("C-CAPABILITY-85"),
      capabilityGrants: ["knowledge.read", "docs_work.manage"],
    }));
    const handoff = await createHandoff(active, "resolve exact authority", "585");
    const ready = await prepareWatchDispatch(handoff, readinessContext(NOW));

    const authority = await resolveWatchDispatchCapabilityAuthority(
      ready.reservation.id,
      { capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY, now: NOW },
    );
    assert.deepEqual(authority, {
      reservationId: ready.reservation.id,
      watchId: active.id,
      effectiveRevisionId: active.effectiveRevision.id,
      capabilityGrants: ["knowledge.read", "docs_work.manage"],
    });

    await assert.rejects(
      () => resolveWatchDispatchCapabilityAuthority(
        "f".repeat(64),
        { capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY, now: NOW },
      ),
      errorWithCode("authority-unavailable"),
    );

    await mutateWatchLifecycle({
      watchId: active.id,
      action: "pause",
      expectedStateRevision: active.stateRevision,
      operationKey: "pause-capability-resolution-85",
      reason: "Prove executor-time authority is current.",
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    });
    await assert.rejects(
      () => resolveWatchDispatchCapabilityAuthority(
        ready.reservation.id,
        { capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY, now: NOW },
      ),
      errorWithCode("authority-unavailable"),
    );
  });
});

test("pause, deletion, policy expiry, and effective revision replacement block dispatch", async () => {
  await withTemporaryDatabase(async () => {
    const paused = await createActiveWatch(policy({ source: source("C-PAUSE-75") }));
    const pausedHandoff = await createHandoff(paused, "pause me", "601");
    await mutateWatchLifecycle({
      watchId: paused.id,
      action: "pause",
      expectedStateRevision: paused.stateRevision,
      operationKey: "pause-dispatch-75",
      reason: "Verify dispatch stops after pause.",
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    });
    await assert.rejects(
      () => prepareWatchDispatch(pausedHandoff, readinessContext(NOW)),
      errorWithCode("authority-unavailable"),
    );

    const deleted = await createActiveWatch(policy({ source: source("C-DELETE-75") }));
    const deletedHandoff = await createHandoff(deleted, "delete me", "602");
    await mutateWatchLifecycle({
      watchId: deleted.id,
      action: "delete",
      expectedStateRevision: deleted.stateRevision,
      operationKey: "delete-dispatch-75",
      reason: "Verify dispatch stops after deletion.",
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    });
    await assert.rejects(
      () => prepareWatchDispatch(deletedHandoff, readinessContext(NOW)),
      errorWithCode("authority-unavailable"),
    );

    const expiring = await createActiveWatch(policy({
      source: source("C-EXPIRE-75"),
      expiresAt: "2026-07-13T22:01:00.000Z",
    }));
    const expiringHandoff = await createHandoff(expiring, "expire me", "603");
    await assert.rejects(
      () => prepareWatchDispatch(
        expiringHandoff,
        readinessContext(new Date("2026-07-13T22:01:00.000Z")),
      ),
      errorWithCode("authority-unavailable"),
    );

    const replaced = await createActiveWatch(policy({ source: source("C-REPLACE-75") }));
    const oldHandoff = await createHandoff(replaced, "old authority", "604");
    const proposal = await editWatchProposal({
      watchId: replaced.id,
      expectedProposalRevision: 1,
      policy: {
        ...replaced.effectiveRevision.policy,
        goal: "Replacement with broader approved authority.",
        capabilityGrants: ["knowledge.read", "repository.read"],
      },
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    });
    await approveWatchProposal({
      watchId: replaced.id,
      proposalRevisionId: proposal.watch.latestProposal.id,
      expectedProposalRevision: proposal.watch.latestProposal.revision,
      decision: "approved",
      idempotencyKey: `approve-${proposal.watch.latestProposal.id}`,
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    });
    await assert.rejects(
      () => prepareWatchDispatch(oldHandoff, readinessContext(NOW)),
      errorWithCode("authority-unavailable"),
    );
  });
});

test("provider authorization, claims, retention, and unapproved expansion fail closed", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({ source: source("C-AUTH-75") }));
    const handoff = await createHandoff(active, "authorized content", "701");
    await assert.rejects(
      () => prepareWatchDispatch(handoff, {
        capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      }),
      errorWithCode("provider-authorization-unavailable"),
    );
    await assert.rejects(
      () => prepareWatchDispatch(handoff, {
        ...readinessContext(NOW),
        providerAuthorization: {
          provider: "slack",
          providerWorkspaceId: "T-OTHER",
          verification: "verified-webhook",
        },
      }),
      errorWithCode("provider-authorization-unavailable"),
    );

    await editWatchProposal({
      watchId: active.id,
      expectedProposalRevision: 1,
      policy: {
        ...active.effectiveRevision.policy,
        capabilityGrants: ["knowledge.read", "repository.read"],
      },
    }, {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    });
    const stillOld = await prepareWatchDispatch(handoff, readinessContext(NOW));
    assert.deepEqual(
      stillOld.effectiveRevision.policy.capabilityGrants,
      ["knowledge.read"],
      "an unapproved proposal cannot widen the original handoff",
    );

    await assert.rejects(
      () => prepareWatchDispatch({
        ...handoff,
        claimIds: ["a".repeat(64)],
      }, readinessContext(NOW)),
      errorWithCode("handoff-invalid"),
    );
    await assert.rejects(
      () => prepareWatchDispatch({
        ...handoff,
        observations: handoff.observations.map((observation) => ({
          ...observation,
          content: { ...observation.content, retentionSeconds: 60 },
        })),
      }, readinessContext(NOW)),
      errorWithCode("handoff-invalid"),
    );
  });
});

test("dispatch readiness owns no Eve or product-side-effect path and rejects malformed handoffs", async () => {
  const sourceCode = await readFile(
    new URL("../src/watch-dispatch-readiness.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "eve/",
    "docs-signals",
    "workspace-memory",
    "docs-follow-ups",
    "libsql-chat-state",
  ]) {
    assert.equal(sourceCode.includes(forbidden), false);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "paige-dispatch-unavailable-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "unmigrated.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await assert.rejects(
      () => prepareWatchDispatch({} as never, readinessContext(NOW)),
      errorWithCode("handoff-invalid"),
    );
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function createHandoff(
  active: ActivePolicyBoundWatch,
  text: string,
  occurrence: string,
) {
  const observation = createEphemeralWatchObservation({
    watchId: active.id,
    effectiveRevisionId: active.effectiveRevision.id,
    source: active.effectiveRevision.policy.source,
    actor: { kind: "user", id: "U-PRIVATE" },
    occurredAt: NOW.toISOString(),
    eventType: "message",
    thread: null,
    permalink: `https://example.slack.com/archives/${active.effectiveRevision.policy.source.resource.id}/p${occurrence}`,
    provenance: {
      ingress: "provider-adapter",
      providerWorkspaceId: "T-DOCS",
      providerEventId: `slack:T-DOCS:${active.effectiveRevision.policy.source.resource.id}:${occurrence}`,
      receivedAt: NOW.toISOString(),
      adapter: { name: "slack-events", version: "1" },
    },
    content: { text, mediaType: "text/plain" },
  }, active.effectiveRevision);
  const claimResult = await claimWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    watchId: observation.watchId,
    effectiveRevisionId: observation.effectiveRevisionId,
    source: observation.source,
    providerEventId: observation.provenance.providerEventId,
  }, { now: NOW });
  const assembled = await assembleClaimedWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    claimResult,
    observation,
  }, { now: NOW });
  const handoff = assembled.handoffs[0];
  if (handoff === undefined) throw new Error("Expected a per-event handoff.");
  return handoff;
}

async function createActiveWatch(
  proposedPolicy: ProposedWatchPolicy,
): Promise<ActivePolicyBoundWatch> {
  await prepareWatchWorkspace();
  const proposed = await createProposedWatch({
    policy: proposedPolicy,
    actor: { id: "author-75", githubLogin: "watch-author" },
  }, {
    capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
    now: NOW,
  });
  return (await approveWatchProposal({
    watchId: proposed.id,
    proposalRevisionId: proposed.latestProposal.id,
    expectedProposalRevision: proposed.latestProposal.revision,
    decision: "approved",
    idempotencyKey: `approve-${proposed.id}`,
  }, {
    capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
    operator: OPERATOR,
    now: NOW,
  })).watch;
}

function policy(overrides: Partial<ProposedWatchPolicy> = {}): ProposedWatchPolicy {
  return {
    source: source("C-DISPATCH-75"),
    goal: "Prepare bounded evidence for later documentation evaluation.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 1_000,
    },
    capabilityGrants: ["knowledge.read"],
    retention: { rawObservationSeconds: 0, auditDays: 30 },
    budgets: {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function source(channelId: string) {
  return {
    provider: "slack" as const,
    resource: { type: "channel" as const, id: channelId },
  };
}

function readinessContext(now: Date) {
  return {
    capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
    providerAuthorization: {
      provider: "slack" as const,
      providerWorkspaceId: "T-DOCS",
      verification: "verified-webhook" as const,
    },
    now,
  };
}

async function sideEffectCounts() {
  return withDocsAgentDatabase(async (db) => ({
    signals: (await db.select().from(docsSignals)).length,
    memories: (await db.select().from(workspaceMemoryRecords)).length,
    followUps: (await db.select().from(docsFollowUps)).length,
  }));
}

function errorWithCode(code: WatchDispatchReadinessError["code"]) {
  return (error: unknown) =>
    error instanceof WatchDispatchReadinessError && error.code === code;
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-dispatch-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "dispatch.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await migrateDocsAgentDatabase();
    await run();
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
