import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { test } from "vitest";

import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  docsFollowUps,
  docsSignals,
  internalDocumentAttachments,
  internalDocuments,
  watchActionOutcomes,
  watchDispatchReservations,
  watchProviderDeliveries,
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
import { prepareWatchDispatch } from "../src/watch-dispatch-readiness.ts";
import { claimWatchObservation } from "../src/watch-observation-claims.ts";
import { createEphemeralWatchObservation } from "../src/watch-observation.ts";
import { assembleClaimedWatchObservation } from "../src/watch-observation-windows.ts";
import {
  claimDueScheduledWatchDispatches,
  claimDueWatchDigestDeliveries,
  claimImmediateWatchProviderDelivery,
  claimPendingWatchTurnDispatches,
  claimPreparedWatchTurnDispatch,
  claimWatchTurnDispatch,
  completeWatchProviderDelivery,
  expireWatchRuntimeData,
  failWatchProviderDelivery,
  prepareWatchProviderDelivery,
  recordWatchActionOutcome,
  recordWatchTerminalOutcome,
  releaseWatchTurnDispatch,
} from "../src/watch-runtime.ts";
import { resolveWatchContinuityContext } from "../src/watch-continuity.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_CAPABILITY_REGISTRY,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-14T20:05:00.000Z");
const OPERATOR = { id: "operator-60", githubLogin: "docs-owner" };

test("a watch turn records a redacted no-op and clears its raw handoff", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy());
    const claimed = await prepareAndClaimEvent(active, "ignore this observation", "601");

    await recordWatchTerminalOutcome({
      reservationId: claimed.dispatch.reservation.id,
      claimToken: claimed.claimToken,
      sessionId: "session-no-op-60",
      turnId: "turn-no-op-60",
      status: "succeeded",
    });

    const reservation = await readReservation(claimed.dispatch.reservation.id);
    const outcomes = await withDocsAgentDatabase((db) => db.select()
      .from(watchActionOutcomes));
    assert.equal(reservation?.status, "completed");
    assert.equal(reservation?.handoffPayload, null);
    assert.deepEqual(outcomes.map(({ action, capabilityFamily, status }) => ({
      action,
      capabilityFamily,
      status,
    })), [{ action: "no-op", capabilityFamily: null, status: "no-op" }]);
    assert.doesNotMatch(JSON.stringify({ reservation, outcomes }), /ignore this observation/u);
    assert.deepEqual(await productSideEffectCounts(), {
      followUps: 0,
      memories: 0,
      signals: 0,
    });
  });
});

test("watch continuity resolves one attached document across sessions and effective revisions", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      capabilityGrants: ["docs_work.manage"],
      retention: { rawObservationSeconds: 1_800, auditDays: 45 },
    }));
    const first = await prepareAndClaimEvent(
      active,
      "A raw provider observation that must not be copied automatically.",
      "continuity-a-77",
    );
    const [firstSession, concurrentSession] = await Promise.all([
      resolveWatchContinuityContext(
        first.dispatch.reservation.id,
        runtimeContext(NOW),
        { sessionId: "session-continuity-a", runId: "turn-continuity-a", now: NOW },
        { claimToken: first.claimToken },
      ),
      resolveWatchContinuityContext(
        first.dispatch.reservation.id,
        runtimeContext(NOW),
        { sessionId: "session-continuity-race", runId: "turn-continuity-race", now: NOW },
        { claimToken: first.claimToken },
      ),
    ]);
    assert.ok(firstSession.document !== null);
    assert.ok(concurrentSession.document !== null);
    assert.equal(firstSession.document.id, concurrentSession.document.id);
    assert.equal(firstSession.document.currentRevision, 1);
    assert.equal(firstSession.document.editingProfile, "living-summary");
    assert.equal(
      firstSession.document.retentionExpiresAt,
      new Date(NOW.getTime() + 45 * 86_400_000).toISOString(),
    );
    assert.doesNotMatch(
      firstSession.document.content ?? "",
      /raw provider observation/u,
    );
    assert.deepEqual(
      firstSession.document.revisions[0]?.sourceReferences.map(({ kind, id }) => ({ kind, id })),
      [
        { kind: "policy-bound-watch", id: active.id },
        { kind: "watch-effective-revision", id: active.effectiveRevision.id },
        { kind: "watch-occurrence", id: first.dispatch.reservation.id },
      ],
    );
    assert.equal(
      [
        "session-continuity-a/turn-continuity-a",
        "session-continuity-race/turn-continuity-race",
      ].includes([
        firstSession.document.revisions[0]?.sessionId,
        firstSession.document.revisions[0]?.runId,
      ].join("/")),
      true,
    );

    await recordWatchTerminalOutcome({
      reservationId: first.dispatch.reservation.id,
      claimToken: first.claimToken,
      sessionId: "session-continuity-a",
      turnId: "turn-continuity-a",
      status: "succeeded",
    });
    const edited = await editWatchProposal({
      watchId: active.id,
      expectedProposalRevision: 1,
      policy: {
        ...active.effectiveRevision.policy,
        goal: "Preserve the same continuity while applying a replacement effective revision.",
      },
    }, {
      ...runtimeContext(NOW),
      operator: OPERATOR,
    });
    const replacement = (await approveWatchProposal({
      watchId: active.id,
      proposalRevisionId: edited.watch.latestProposal.id,
      expectedProposalRevision: edited.watch.latestProposal.revision,
      decision: "approved",
      idempotencyKey: `approve-${edited.watch.latestProposal.id}`,
    }, {
      ...runtimeContext(NOW),
      operator: OPERATOR,
    })).watch;
    assert.notEqual(replacement.effectiveRevision.id, active.effectiveRevision.id);
    const second = await prepareAndClaimEvent(
      replacement,
      "A later occurrence starts a fresh Eve session.",
      "continuity-b-77",
    );
    const laterSession = await resolveWatchContinuityContext(
      second.dispatch.reservation.id,
      runtimeContext(NOW),
      { sessionId: "session-continuity-b", runId: "turn-continuity-b", now: NOW },
      { claimToken: second.claimToken },
    );
    assert.ok(laterSession.document !== null);
    assert.equal(laterSession.document.id, firstSession.document.id);
    assert.equal(laterSession.document.currentRevision, 1);
    assert.equal(laterSession.runtime.effectiveRevisionId, replacement.effectiveRevision.id);

    const counts = await withDocsAgentDatabase(async (db) => ({
      attachments: (await db.select().from(internalDocumentAttachments)).length,
      documents: (await db.select().from(internalDocuments)).length,
    }));
    assert.deepEqual(counts, { attachments: 1, documents: 1 });
  });
});

test("watch continuity does not create document authority when docs work is not granted", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({ capabilityGrants: ["knowledge.read"] }));
    const claimed = await prepareAndClaimEvent(active, "Read-only occurrence.", "continuity-denied-77");
    const continuity = await resolveWatchContinuityContext(
      claimed.dispatch.reservation.id,
      runtimeContext(NOW),
      { sessionId: "session-no-docs-work", runId: "turn-no-docs-work", now: NOW },
      { claimToken: claimed.claimToken },
    );
    assert.equal(continuity.document, null);
    assert.equal(
      (await withDocsAgentDatabase((db) => db.select().from(internalDocuments))).length,
      0,
    );
  });
});

test("framework web actions are attributed to knowledge read", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy());
    const claimed = await prepareAndClaimEvent(active, "inspect current sources", "609");
    for (const [index, action] of ["web_fetch", "web_search"].entries()) {
      await recordWatchActionOutcome({
        reservationId: claimed.dispatch.reservation.id,
        claimToken: claimed.claimToken,
        sessionId: "session-web-60",
        turnId: "turn-web-60",
        actionKey: `call-web-${index}`,
        action,
        status: "succeeded",
      });
    }
    const outcomes = await withDocsAgentDatabase((db) => db.select({
      action: watchActionOutcomes.action,
      capabilityFamily: watchActionOutcomes.capabilityFamily,
    }).from(watchActionOutcomes));
    assert.deepEqual(outcomes.sort((left, right) => left.action.localeCompare(right.action)), [
      { action: "web_fetch", capabilityFamily: "knowledge.read" },
      { action: "web_search", capabilityFamily: "knowledge.read" },
    ]);
  });
});

test("a crashed dispatch is reclaimed while stale claim tokens cannot release or finish it", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy());
    const first = await prepareAndClaimEvent(active, "retry this observation", "602");
    const reservationId = first.dispatch.reservation.id;
    const reclaimedAt = new Date(NOW.getTime() + 10 * 60_000 + 1);
    const second = await claimWatchTurnDispatch(
      reservationId,
      runtimeContext(reclaimedAt),
    );
    assert.ok(second !== null);
    assert.notEqual(second.claimToken, first.claimToken);

    await releaseWatchTurnDispatch({
      reservationId,
      claimToken: first.claimToken,
    }, reclaimedAt);
    assert.equal((await readReservation(reservationId))?.status, "dispatching");
    await assert.rejects(
      () => recordWatchTerminalOutcome({
        reservationId,
        claimToken: first.claimToken,
        sessionId: "session-stale-60",
        turnId: "turn-stale-60",
        status: "succeeded",
      }),
      errorWithCode("authority-unavailable"),
    );

    await recordWatchTerminalOutcome({
      reservationId,
      claimToken: second.claimToken,
      sessionId: "session-current-60",
      turnId: "turn-current-60",
      status: "succeeded",
    });
    const reservation = await readReservation(reservationId);
    assert.equal(reservation?.attempts, 2);
    assert.equal(reservation?.status, "completed");
  });
});

test("raw observation retention caps the lease and terminally clears expired handoffs", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      retention: { rawObservationSeconds: 60, auditDays: 30 },
    }));
    const claimed = await prepareAndClaimEvent(active, "short-lived raw content", "605");
    const reservationId = claimed.dispatch.reservation.id;
    assert.equal(
      (await readReservation(reservationId))?.leaseExpiresAt,
      new Date(NOW.getTime() + 60_000).toISOString(),
    );
    assert.equal(
      await claimWatchTurnDispatch(
        reservationId,
        runtimeContext(new Date(NOW.getTime() + 60_001)),
      ),
      null,
    );
    await expireWatchRuntimeData(new Date(NOW.getTime() + 60_001));
    const expired = await readReservation(reservationId);
    assert.equal(expired?.status, "failed");
    assert.equal(expired?.handoffPayload, null);
  });
});

test("zero-retention events use one ephemeral prepared claim and never enter durable retry", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      retention: { rawObservationSeconds: 0, auditDays: 30 },
    }));
    const ready = await prepareEvent(active, "never persist this raw content", "606");
    const claimAt = new Date(NOW.getTime() + 30_000);
    let reservation = await readReservation(ready.reservation.id);
    assert.equal(reservation?.handoffPayload, null);
    assert.equal(
      reservation?.payloadExpiresAt,
      new Date(NOW.getTime() + 60_000).toISOString(),
    );
    assert.doesNotMatch(JSON.stringify(reservation), /never persist this raw content/u);

    assert.equal((await expireWatchRuntimeData(claimAt)).expiredDispatches, 0);
    assert.deepEqual(
      await claimPendingWatchTurnDispatches(runtimeContext(claimAt)),
      [],
    );
    assert.equal(
      await claimWatchTurnDispatch(ready.reservation.id, runtimeContext(claimAt)),
      null,
    );
    const claimed = await claimPreparedWatchTurnDispatch(ready, runtimeContext(claimAt));
    assert.ok(claimed !== null);
    assert.ok("handoff" in claimed.dispatch);
    assert.equal(claimed.dispatch.handoff.observations[0]?.content.text,
      "never persist this raw content");
    assert.equal(
      await claimPreparedWatchTurnDispatch(ready, runtimeContext(claimAt)),
      null,
    );

    await releaseWatchTurnDispatch({
      reservationId: ready.reservation.id,
      claimToken: claimed.claimToken,
    }, claimAt);
    reservation = await readReservation(ready.reservation.id);
    assert.equal(reservation?.status, "failed");
    assert.equal(reservation?.handoffPayload, null);
    assert.equal(reservation?.leaseToken, null);

    const unclaimed = await prepareEvent(active, "also never persist this", "607");
    const cleanup = await expireWatchRuntimeData(new Date(NOW.getTime() + 60_000));
    assert.equal(cleanup.expiredDispatches, 1);
    assert.equal((await readReservation(unclaimed.reservation.id))?.status, "failed");
  });
});

test("immediate delivery is source-bound, budgeted idempotently, and lease-token safe", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      delivery: { mode: "immediate" },
      capabilityGrants: ["provider.deliver"],
      budgets: budgets({ deliveriesPerDay: 1 }),
    }));
    const claimed = await prepareAndClaimEvent(active, "deliver this", "603");
    const reservationId = claimed.dispatch.reservation.id;
    const queued = await prepareWatchProviderDelivery({
      reservationId,
      dispatchClaimToken: claimed.claimToken,
      callId: "call-immediate-60",
      sessionId: "session-immediate-60",
      turnId: "turn-immediate-60",
      content: "A source-bound reply.",
    }, runtimeContext(NOW));
    const replay = await prepareWatchProviderDelivery({
      reservationId,
      dispatchClaimToken: claimed.claimToken,
      callId: "call-immediate-60",
      sessionId: "session-immediate-60",
      turnId: "turn-immediate-60",
      content: "A source-bound reply.",
    }, runtimeContext(NOW));
    assert.equal(replay.id, queued.id);
    await assert.rejects(
      () => prepareWatchProviderDelivery({
        reservationId,
        dispatchClaimToken: claimed.claimToken,
        callId: "call-over-budget-60",
        sessionId: "session-immediate-60",
        turnId: "turn-immediate-60",
        content: "A second reply.",
      }, runtimeContext(NOW)),
      errorWithCode("budget-exhausted"),
    );

    const first = await claimImmediateWatchProviderDelivery(
      queued.id,
      reservationId,
      runtimeContext(NOW),
    );
    assert.ok(first !== null);
    assert.equal(first.providerWorkspaceId, "T-DOCS");
    assert.equal(first.resourceId, "C-WATCH-60");
    await failWatchProviderDelivery(first);
    const second = await claimImmediateWatchProviderDelivery(
      queued.id,
      reservationId,
      runtimeContext(new Date(NOW.getTime() + 1_000)),
    );
    assert.ok(second !== null);
    assert.notEqual(second.claimToken, first.claimToken);

    await completeWatchProviderDelivery(first);
    let row = await readDelivery(queued.id);
    assert.equal(row?.status, "sending");
    assert.equal(row?.leaseToken, second.claimToken);
    await completeWatchProviderDelivery(second);
    await completeWatchProviderDelivery(second);
    row = await readDelivery(queued.id);
    assert.equal(row?.attempts, 2);
    assert.equal(row?.content, null);
    assert.equal(row?.status, "sent");
  });
});

test("digest retries preserve whole batch membership and provider idempotency", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      delivery: {
        mode: "digest",
        schedule: { cron: "* * * * *", timeZone: "UTC" },
      },
      capabilityGrants: ["provider.deliver"],
      budgets: budgets({ deliveriesPerDay: 3 }),
    }));
    const claimed = await prepareAndClaimEvent(active, "compose a digest", "604");
    const reservationId = claimed.dispatch.reservation.id;
    const firstQueued = await queueDelivery("call-digest-a-60", "Digest item A", 0);
    const secondQueued = await queueDelivery("call-digest-b-60", "Digest item B", 1_000);
    const firstBatch = (await claimDueWatchDigestDeliveries(
      runtimeContext(new Date(NOW.getTime() + 2_000)),
      { limit: 1 },
    ))[0];
    assert.ok(firstBatch !== undefined);
    assert.deepEqual(
      [...firstBatch.deliveryIds].sort(),
      [firstQueued.id, secondQueued.id].sort(),
    );
    await failWatchProviderDelivery(firstBatch);

    const thirdQueued = await queueDelivery("call-digest-c-60", "Digest item C", 3_000);
    const retriedBatch = (await claimDueWatchDigestDeliveries(
      runtimeContext(new Date(NOW.getTime() + 4_000)),
      { limit: 1 },
    ))[0];
    assert.ok(retriedBatch !== undefined);
    assert.deepEqual(retriedBatch.deliveryIds, firstBatch.deliveryIds);
    assert.equal(retriedBatch.clientMessageId, firstBatch.clientMessageId);
    assert.equal(retriedBatch.content, firstBatch.content);
    const pendingThird = await readDelivery(thirdQueued.id);
    assert.equal(pendingThird?.digestBatchId, null);
    assert.equal(pendingThird?.status, "pending");

    async function queueDelivery(callId: string, content: string, offsetMs: number) {
      return prepareWatchProviderDelivery({
        reservationId,
        dispatchClaimToken: claimed.claimToken,
        callId,
        sessionId: "session-digest-60",
        turnId: "turn-digest-60",
        content,
      }, runtimeContext(new Date(NOW.getTime() + offsetMs)));
    }
  });
});

test("a frozen digest batch fails atomically when one member loses authority", async () => {
  await withTemporaryDatabase(async () => {
    const active = await createActiveWatch(policy({
      delivery: {
        mode: "digest",
        schedule: { cron: "* * * * *", timeZone: "UTC" },
      },
      capabilityGrants: ["provider.deliver"],
      budgets: budgets({ deliveriesPerDay: 2 }),
    }));
    const claimedA = await prepareAndClaimEvent(active, "compose digest A", "610");
    const claimedB = await prepareAndClaimEvent(active, "compose digest B", "611");
    const queuedA = await queueForClaim(
      claimedA,
      "call-digest-authority-a-60",
      "Digest authority item A",
      0,
    );
    const queuedB = await queueForClaim(
      claimedB,
      "call-digest-authority-b-60",
      "Digest authority item B",
      1_000,
    );
    const firstBatch = (await claimDueWatchDigestDeliveries(
      runtimeContext(new Date(NOW.getTime() + 2_000)),
      { limit: 1 },
    ))[0];
    assert.ok(firstBatch !== undefined);
    assert.deepEqual(
      [...firstBatch.deliveryIds].sort(),
      [queuedA.id, queuedB.id].sort(),
    );
    await failWatchProviderDelivery(firstBatch);

    await withDocsAgentDatabase((db) => db.update(watchDispatchReservations).set({
      leaseToken: "00000000-0000-4000-8000-000000000060",
    }).where(eq(watchDispatchReservations.id, claimedA.dispatch.reservation.id)));
    const retry = await claimDueWatchDigestDeliveries(
      runtimeContext(new Date(NOW.getTime() + 3_000)),
      { limit: 1 },
    );
    assert.deepEqual(retry, []);
    const failedA = await readDelivery(queuedA.id);
    const failedB = await readDelivery(queuedB.id);
    assert.ok(failedA?.digestBatchId !== null);
    assert.equal(failedB?.digestBatchId, failedA?.digestBatchId);
    assert.deepEqual(
      [failedA, failedB].map((row) => ({ status: row?.status, content: row?.content })),
      [
        { status: "failed", content: null },
        { status: "failed", content: null },
      ],
    );

    async function queueForClaim(
      claimed: Awaited<ReturnType<typeof prepareAndClaimEvent>>,
      callId: string,
      content: string,
      offsetMs: number,
    ) {
      return prepareWatchProviderDelivery({
        reservationId: claimed.dispatch.reservation.id,
        dispatchClaimToken: claimed.claimToken,
        callId,
        sessionId: "session-digest-authority-60",
        turnId: "turn-digest-authority-60",
        content,
      }, runtimeContext(new Date(NOW.getTime() + offsetMs)));
    }
  });
});

test("scheduled per-event watches claim each real DST occurrence exactly once", async () => {
  await withTemporaryDatabase(async () => {
    await createActiveWatch(policy({
      trigger: {
        type: "on_schedule",
        schedule: { cron: "30 2 * * *", timeZone: "Europe/Warsaw" },
      },
      evaluation: { mode: "per_event" },
      expiresAt: "2026-12-01T00:00:00.000Z",
    }));
    const firstOccurrence = new Date("2026-10-25T00:30:00.000Z");
    const secondOccurrence = new Date("2026-10-25T01:30:00.000Z");
    const first = await claimDueScheduledWatchDispatches(runtimeContext(firstOccurrence));
    const replay = await claimDueScheduledWatchDispatches(runtimeContext(firstOccurrence));
    const second = await claimDueScheduledWatchDispatches(runtimeContext(secondOccurrence));
    assert.equal(first.length, 1);
    assert.deepEqual(replay, []);
    assert.equal(second.length, 1);
    assert.notEqual(first[0]?.reservation.id, second[0]?.reservation.id);
    assert.notEqual(first[0]?.occurrenceKey, second[0]?.occurrenceKey);
  });
});

test("an exhausted scheduled-watch budget skips the occurrence without aborting the tick", async () => {
  await withTemporaryDatabase(async () => {
    await createActiveWatch(policy({
      trigger: {
        type: "on_schedule",
        schedule: { cron: "* * * * *", timeZone: "UTC" },
      },
      evaluation: { mode: "per_event" },
      budgets: budgets({ processingRunsPerHour: 1 }),
    }));

    const first = await claimDueScheduledWatchDispatches(runtimeContext(NOW));
    const overBudget = await claimDueScheduledWatchDispatches(
      runtimeContext(new Date(NOW.getTime() + 60_000)),
    );
    assert.equal(first.length, 1);
    assert.deepEqual(overBudget, []);
  });
});

async function prepareAndClaimEvent(
  active: ActivePolicyBoundWatch,
  text: string,
  occurrence: string,
) {
  const ready = await prepareEvent(active, text, occurrence);
  const claimed = await claimPreparedWatchTurnDispatch(ready, runtimeContext(NOW));
  assert.ok(claimed !== null);
  return claimed;
}

async function prepareEvent(
  active: ActivePolicyBoundWatch,
  text: string,
  occurrence: string,
) {
  const observation = createEphemeralWatchObservation({
    watchId: active.id,
    effectiveRevisionId: active.effectiveRevision.id,
    source: active.effectiveRevision.policy.source,
    actor: { kind: "user", id: "U-WATCH-60" },
    occurredAt: NOW.toISOString(),
    eventType: "message",
    thread: null,
    permalink: `https://example.slack.com/archives/C-WATCH-60/p${occurrence}`,
    provenance: {
      ingress: "provider-adapter",
      providerWorkspaceId: "T-DOCS",
      providerEventId: `slack:T-DOCS:C-WATCH-60:${occurrence}`,
      receivedAt: NOW.toISOString(),
      adapter: { name: "slack-events", version: "1" },
    },
    content: { text, mediaType: "text/plain" },
  }, active.effectiveRevision);
  const occurrenceClaim = await claimWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    watchId: active.id,
    effectiveRevisionId: active.effectiveRevision.id,
    source: active.effectiveRevision.policy.source,
    providerEventId: observation.provenance.providerEventId,
  }, { now: NOW });
  const assembled = await assembleClaimedWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    claimResult: occurrenceClaim,
    observation,
  }, { now: NOW });
  const handoff = assembled.handoffs[0];
  assert.ok(handoff !== undefined);
  const ready = await prepareWatchDispatch(handoff, {
    ...runtimeContext(NOW),
    providerAuthorization: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      verification: "verified-webhook",
    },
  });
  return ready;
}

async function createActiveWatch(
  proposedPolicy: ProposedWatchPolicy,
): Promise<ActivePolicyBoundWatch> {
  await prepareWatchWorkspace();
  const proposed = await createProposedWatch({
    policy: proposedPolicy,
    actor: { id: "author-60", githubLogin: "watch-author" },
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
    source: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      resource: { type: "channel", id: "C-WATCH-60" },
    },
    goal: "Apply the approved watch goal with only approved capabilities.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    },
    capabilityGrants: ["knowledge.read"],
    retention: { rawObservationSeconds: 1_800, auditDays: 30 },
    budgets: budgets(),
    expiresAt: "2026-12-01T00:00:00.000Z",
    ...overrides,
  };
}

function budgets(overrides: Partial<ProposedWatchPolicy["budgets"]> = {}) {
  return {
    observationsPerHour: 60,
    processingRunsPerHour: 12,
    deliveriesPerDay: 0,
    inputCharactersPerHour: 120_000,
    ...overrides,
  };
}

function runtimeContext(now: Date) {
  return { capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY, now };
}

async function readReservation(id: string) {
  return (await withDocsAgentDatabase((db) => db.select()
    .from(watchDispatchReservations)
    .where(eq(watchDispatchReservations.id, id))
    .limit(1)))[0];
}

async function readDelivery(id: string) {
  return (await withDocsAgentDatabase((db) => db.select()
    .from(watchProviderDeliveries)
    .where(eq(watchProviderDeliveries.id, id))
    .limit(1)))[0];
}

async function productSideEffectCounts() {
  return withDocsAgentDatabase(async (db) => ({
    followUps: (await db.select().from(docsFollowUps)).length,
    memories: (await db.select().from(workspaceMemoryRecords)).length,
    signals: (await db.select().from(docsSignals)).length,
  }));
}

function errorWithCode(code: string) {
  return (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-runtime-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "runtime.sqlite")}`;
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
