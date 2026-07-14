import { createHash, randomUUID } from "node:crypto";

import { CronExpressionParser } from "cron-parser";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.ts";
import {
  policyBoundWatches,
  watchActionOutcomes,
  watchDeliveryBudgetBuckets,
  watchDispatchReservations,
  watchEffectiveRevisions,
  watchProcessingBudgetBuckets,
  watchProviderDeliveries,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  capabilityFamilySchema,
  type CapabilityFamily,
} from "./capability-contract.ts";
import {
  effectiveWatchRevisionSchema,
  type EffectiveWatchRevision,
} from "./watch-contract.ts";
import {
  resolveWatchDispatchCapabilityAuthority,
  WATCH_EPHEMERAL_DISPATCH_CLAIM_MS,
  watchDispatchReadyHandoffSchema,
  watchDispatchReservationSchema,
  WatchDispatchReadinessError,
  type WatchDispatchReadyHandoff,
} from "./watch-dispatch-readiness.ts";
import { watchObservationHandoffSchema } from "./watch-observation-windows.ts";
import {
  requireWatchServiceReady,
  type WatchServiceContext,
} from "./watch-service-readiness.ts";

const reservationIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().trim().min(1).max(500);
const deliveryContentSchema = z.string().trim().min(1).max(12_000);
const WATCH_DELIVERY_MAX_ATTEMPTS = 3;
const WATCH_DELIVERY_LEASE_MS = 10 * 60_000;

class ConcurrentDeliveryClaim extends Error {}

type WatchOutcomeDatabase = Pick<DocsAgentDatabase, "insert" | "select" | "update">;

export const watchRuntimeContextSchema = z.object({
  reservationId: reservationIdSchema,
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  providerWorkspaceId: identifierSchema,
  source: z.object({
    provider: identifierSchema,
    providerWorkspaceId: identifierSchema,
    resource: z.object({ type: identifierSchema, id: identifierSchema }).strict(),
  }).strict(),
  goal: z.string().min(1).max(4_000),
  trigger: z.unknown(),
  evaluation: z.unknown(),
  delivery: z.unknown(),
  capabilityGrants: z.array(capabilityFamilySchema.exclude(["publication.publish"])),
  deliveriesPerDay: z.number().int().min(0).max(1_000),
  auditRetentionDays: z.number().int().min(1).max(365),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const scheduledWatchDispatchSchema = z.object({
  reservation: watchDispatchReservationSchema,
  effectiveRevision: effectiveWatchRevisionSchema,
  occurrenceKey: z.string().min(1).max(500),
  preparedAt: z.string().datetime({ offset: true }),
}).strict();

const WATCH_DISPATCH_MAX_ATTEMPTS = 3;
const WATCH_DISPATCH_LEASE_MS = 10 * 60_000;

export const watchProviderDeliverySchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  reservationId: reservationIdSchema,
  provider: z.literal("slack"),
  providerWorkspaceId: identifierSchema,
  resourceType: z.literal("channel"),
  resourceId: identifierSchema,
  mode: z.enum(["immediate", "digest"]),
  status: z.enum(["pending", "sending", "sent", "failed"]),
  clientMessageId: z.string().uuid(),
  content: deliveryContentSchema.nullable(),
  attempts: z.number().int().nonnegative(),
}).strict();

export const preparedWatchProviderDeliverySchema = z.object({
  deliveryIds: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).min(1).max(100),
  reservationId: reservationIdSchema,
  provider: z.literal("slack"),
  providerWorkspaceId: identifierSchema,
  resourceType: z.literal("channel"),
  resourceId: identifierSchema,
  mode: z.enum(["immediate", "digest"]),
  clientMessageId: z.string().uuid(),
  claimToken: z.string().uuid(),
  content: deliveryContentSchema,
}).strict();

export type WatchRuntimeContext = z.infer<typeof watchRuntimeContextSchema>;
export type ScheduledWatchDispatch = z.infer<typeof scheduledWatchDispatchSchema>;
export type WatchTurnDispatch = WatchDispatchReadyHandoff | ScheduledWatchDispatch;
export type ClaimedWatchTurnDispatch = {
  dispatch: WatchTurnDispatch;
  claimToken: string;
};
export type WatchProviderDelivery = z.infer<typeof watchProviderDeliverySchema>;
export type PreparedWatchProviderDelivery = z.infer<
  typeof preparedWatchProviderDeliverySchema
>;

export class WatchRuntimeError extends Error {
  readonly code:
    | "authority-unavailable"
    | "budget-exhausted"
    | "delivery-unavailable"
    | "destination-unavailable"
    | "retry-exhausted"
    | "runtime-capacity-exceeded"
    | "storage-unavailable";

  constructor(code: WatchRuntimeError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WatchRuntimeError";
    this.code = code;
  }
}

export async function resolveWatchRuntimeContext(
  reservationIdInput: string,
  context: WatchServiceContext,
  options: { claimToken?: string; allowTerminal?: boolean } = {},
): Promise<WatchRuntimeContext> {
  const reservationId = reservationIdSchema.parse(reservationIdInput);
  const authority = await resolveWatchDispatchCapabilityAuthority(
    reservationId,
    context,
    options,
  );
  const now = context.now ?? new Date();
  try {
    return await withDocsAgentDatabase(async (db) => {
      const rows = await db.select({
        providerWorkspaceId: watchDispatchReservations.providerWorkspaceId,
        provider: watchDispatchReservations.provider,
        resourceType: watchDispatchReservations.resourceType,
        resourceId: watchDispatchReservations.resourceId,
        policy: watchEffectiveRevisions.policy,
        contractVersion: watchEffectiveRevisions.contractVersion,
        proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
        approvedById: watchEffectiveRevisions.approvedById,
        approvedByLogin: watchEffectiveRevisions.approvedByLogin,
        approvedAt: watchEffectiveRevisions.approvedAt,
      }).from(watchDispatchReservations).innerJoin(
        watchEffectiveRevisions,
        and(
          eq(watchEffectiveRevisions.id, watchDispatchReservations.effectiveRevisionId),
          eq(watchEffectiveRevisions.watchId, watchDispatchReservations.watchId),
          eq(watchEffectiveRevisions.workspaceId, watchDispatchReservations.workspaceId),
        ),
      ).where(and(
        eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchDispatchReservations.id, reservationId),
      )).limit(1);
      const row = rows[0];
      if (row === undefined) throw authorityUnavailable();
      const revision = effectiveWatchRevisionSchema.safeParse({
        id: authority.effectiveRevisionId,
        watchId: authority.watchId,
        proposalRevisionId: row.proposalRevisionId,
        contractVersion: row.contractVersion,
        policy: row.policy,
        approvedBy: { id: row.approvedById, githubLogin: row.approvedByLogin },
        approvedAt: row.approvedAt,
      });
      if (!revision.success || revision.data.policy.expiresAt === null ||
        now.getTime() >= new Date(revision.data.policy.expiresAt).getTime()) {
        throw authorityUnavailable();
      }
      const policy = revision.data.policy;
      if (
        policy.source.provider !== row.provider ||
        policy.source.providerWorkspaceId !== row.providerWorkspaceId ||
        policy.source.resource.type !== row.resourceType ||
        policy.source.resource.id !== row.resourceId
      ) throw authorityUnavailable();
      return watchRuntimeContextSchema.parse({
        reservationId,
        watchId: authority.watchId,
        effectiveRevisionId: authority.effectiveRevisionId,
        providerWorkspaceId: row.providerWorkspaceId,
        source: policy.source,
        goal: policy.goal,
        trigger: policy.trigger,
        evaluation: policy.evaluation,
        delivery: policy.delivery,
        capabilityGrants: authority.capabilityGrants,
        deliveriesPerDay: policy.budgets.deliveriesPerDay,
        auditRetentionDays: policy.retention.auditDays,
        expiresAt: policy.expiresAt,
      });
    });
  } catch (error) {
    if (error instanceof WatchRuntimeError) throw error;
    throw new WatchRuntimeError(
      "storage-unavailable",
      "Watch runtime context could not be resolved from durable dispatch state.",
      { cause: error },
    );
  }
}

export async function claimDueScheduledWatchDispatches(
  context: WatchServiceContext,
  options: { limit?: number; scanLimit?: number } = {},
): Promise<readonly ScheduledWatchDispatch[]> {
  const readyContext = await requireWatchServiceReady(context);
  const now = readyContext.now ?? new Date();
  const preparedAt = now.toISOString();
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 25);
  const scanLimit = z.number().int().min(limit).max(500).parse(options.scanLimit ?? 500);
  try {
    const candidates = await withDocsAgentDatabase((db) => db.select({
      watchId: policyBoundWatches.id,
      effectiveRevisionId: watchEffectiveRevisions.id,
      proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
      contractVersion: watchEffectiveRevisions.contractVersion,
      policy: watchEffectiveRevisions.policy,
      approvedById: watchEffectiveRevisions.approvedById,
      approvedByLogin: watchEffectiveRevisions.approvedByLogin,
      approvedAt: watchEffectiveRevisions.approvedAt,
    }).from(policyBoundWatches).innerJoin(
      watchEffectiveRevisions,
      and(
        eq(watchEffectiveRevisions.id, policyBoundWatches.effectiveRevisionId),
        eq(watchEffectiveRevisions.watchId, policyBoundWatches.id),
        eq(watchEffectiveRevisions.workspaceId, policyBoundWatches.workspaceId),
      ),
    ).where(and(
      eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(policyBoundWatches.lifecycleState, "active"),
      sql`json_extract(${watchEffectiveRevisions.policy}, '$.trigger.type') = 'on_schedule'`,
    )).orderBy(asc(policyBoundWatches.id)).limit(scanLimit + 1));
    if (candidates.length > scanLimit) {
      throw new WatchRuntimeError(
        "runtime-capacity-exceeded",
        `The watch schedule dispatcher supports at most ${scanLimit} active scheduled watches per tick.`,
      );
    }
    const due: ScheduledWatchDispatch[] = [];
    for (const row of candidates) {
      const revision = effectiveWatchRevisionSchema.safeParse({
        id: row.effectiveRevisionId,
        watchId: row.watchId,
        proposalRevisionId: row.proposalRevisionId,
        contractVersion: row.contractVersion,
        policy: row.policy,
        approvedBy: { id: row.approvedById, githubLogin: row.approvedByLogin },
        approvedAt: row.approvedAt,
      });
      if (!revision.success) throw authorityUnavailable();
      const policy = revision.data.policy;
      if (
        policy.trigger.type !== "on_schedule" ||
        policy.expiresAt === null ||
        now.getTime() >= new Date(policy.expiresAt).getTime() ||
        !cronMatches(policy.trigger.schedule.cron, policy.trigger.schedule.timeZone, now)
      ) continue;
      const occurrenceKey = cronOccurrenceKey(policy.trigger.schedule.timeZone, now);
      const reservationId = hash([
        "watch-schedule",
        DEFAULT_WORKSPACE_ID,
        revision.data.id,
        occurrenceKey,
      ]);
      let claimed: ScheduledWatchDispatch | null;
      try {
        claimed = await reserveScheduledDispatch(
          revision.data,
          reservationId,
          occurrenceKey,
          preparedAt,
        );
      } catch (error) {
        if (error instanceof WatchRuntimeError && error.code === "budget-exhausted") {
          continue;
        }
        throw error;
      }
      if (claimed !== null) due.push(claimed);
      if (due.length >= limit) break;
    }
    return due;
  } catch (error) {
    if (error instanceof WatchRuntimeError) throw error;
    throw new WatchRuntimeError(
      "storage-unavailable",
      "Scheduled watch occurrences could not be claimed.",
      { cause: error },
    );
  }
}

export async function claimWatchTurnDispatch(
  reservationIdInput: string,
  context: WatchServiceContext,
): Promise<ClaimedWatchTurnDispatch | null> {
  const reservationId = reservationIdSchema.parse(reservationIdInput);
  const now = context.now ?? new Date();
  await resolveWatchDispatchCapabilityAuthority(reservationId, context);
  return claimWatchTurnDispatchRow(reservationId, now);
}

export async function claimPreparedWatchTurnDispatch(
  dispatchInput: WatchDispatchReadyHandoff,
  context: WatchServiceContext,
): Promise<ClaimedWatchTurnDispatch | null> {
  const dispatch = watchDispatchReadyHandoffSchema.parse(dispatchInput);
  if (dispatch.effectiveRevision.policy.retention.rawObservationSeconds > 0) {
    return claimWatchTurnDispatch(dispatch.reservation.id, context);
  }
  const authority = await resolveWatchDispatchCapabilityAuthority(
    dispatch.reservation.id,
    context,
  );
  if (
    authority.watchId !== dispatch.effectiveRevision.watchId ||
    authority.effectiveRevisionId !== dispatch.effectiveRevision.id
  ) throw authorityUnavailable();
  return claimEphemeralWatchTurnDispatchRow(
    dispatch,
    context.now ?? new Date(),
  );
}

export async function claimPendingWatchTurnDispatches(
  context: WatchServiceContext,
  options: { limit?: number } = {},
): Promise<readonly ClaimedWatchTurnDispatch[]> {
  await requireWatchServiceReady(context);
  const now = context.now ?? new Date();
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 25);
  const candidateIds = await withDocsAgentDatabase((db) => db.select({
    id: watchDispatchReservations.id,
  }).from(watchDispatchReservations).where(and(
    eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
    lt(watchDispatchReservations.attempts, WATCH_DISPATCH_MAX_ATTEMPTS),
    or(
      eq(watchDispatchReservations.status, "ready"),
      and(
        eq(watchDispatchReservations.status, "dispatching"),
        lte(watchDispatchReservations.leaseExpiresAt, now.toISOString()),
      ),
    ),
    or(
      eq(watchDispatchReservations.handoffKind, "scheduled"),
      isNotNull(watchDispatchReservations.handoffPayload),
    ),
    or(
      isNull(watchDispatchReservations.payloadExpiresAt),
      gt(watchDispatchReservations.payloadExpiresAt, now.toISOString()),
    ),
  )).orderBy(
    asc(watchDispatchReservations.reservedAt),
    asc(watchDispatchReservations.id),
  ).limit(Math.min(100, limit * 4)));
  const claimed: ClaimedWatchTurnDispatch[] = [];
  for (const { id } of candidateIds) {
    try {
      await resolveWatchDispatchCapabilityAuthority(id, context);
      const dispatch = await claimWatchTurnDispatchRow(id, now);
      if (dispatch !== null) claimed.push(dispatch);
    } catch (error) {
      const authorityUnavailable =
        error instanceof WatchRuntimeError && error.code === "authority-unavailable" ||
        error instanceof WatchDispatchReadinessError && error.code === "authority-unavailable";
      if (!authorityUnavailable) throw error;
      await failUnavailableWatchTurnDispatch(id, now);
    }
    if (claimed.length >= limit) break;
  }
  return claimed;
}

async function failUnavailableWatchTurnDispatch(
  reservationId: string,
  now: Date,
): Promise<void> {
  await withDocsAgentDatabase((db) => db.update(watchDispatchReservations).set({
    status: "failed",
    handoffPayload: null,
    payloadExpiresAt: null,
    leaseExpiresAt: null,
    leaseToken: null,
    updatedAt: now.toISOString(),
  }).where(and(
    eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(watchDispatchReservations.id, reservationId),
    or(
      eq(watchDispatchReservations.status, "ready"),
      and(
        eq(watchDispatchReservations.status, "dispatching"),
        lte(watchDispatchReservations.leaseExpiresAt, now.toISOString()),
      ),
    ),
  )));
}

export async function acknowledgeWatchTurnDispatch(input: {
  reservationId: string;
  claimToken: string;
  sessionId: string;
}, nowInput = new Date()): Promise<void> {
  const reservationId = reservationIdSchema.parse(input.reservationId);
  const claimToken = identifierSchema.parse(input.claimToken);
  const sessionId = identifierSchema.parse(input.sessionId);
  await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const terminals = await tx.select({ status: watchActionOutcomes.status })
      .from(watchActionOutcomes).where(and(
        eq(watchActionOutcomes.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchActionOutcomes.reservationId, reservationId),
        eq(watchActionOutcomes.sessionId, sessionId),
        eq(watchActionOutcomes.actionKey, "terminal"),
      )).limit(1);
    const terminalStatus = terminals[0]?.status;
    await tx.update(watchDispatchReservations).set({
      status: terminalStatus === "failed"
        ? "failed"
        : terminalStatus === "succeeded" || terminalStatus === "no-op"
          ? "completed"
          : "dispatched",
      handoffPayload: null,
      payloadExpiresAt: null,
      leaseExpiresAt: null,
      sessionId,
      updatedAt: nowInput.toISOString(),
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchDispatchReservations.id, reservationId),
      eq(watchDispatchReservations.status, "dispatching"),
      eq(watchDispatchReservations.leaseToken, claimToken),
    ));
  }));
}

export async function releaseWatchTurnDispatch(
  input: { reservationId: string; claimToken: string },
  nowInput = new Date(),
): Promise<void> {
  const reservationId = reservationIdSchema.parse(input.reservationId);
  const claimToken = identifierSchema.parse(input.claimToken);
  const now = nowInput.toISOString();
  await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await tx.update(watchDispatchReservations).set({
      status: "ready",
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchDispatchReservations.id, reservationId),
      eq(watchDispatchReservations.status, "dispatching"),
      eq(watchDispatchReservations.leaseToken, claimToken),
      lt(watchDispatchReservations.attempts, WATCH_DISPATCH_MAX_ATTEMPTS),
      or(
        eq(watchDispatchReservations.handoffKind, "scheduled"),
        isNotNull(watchDispatchReservations.handoffPayload),
      ),
      or(
        isNull(watchDispatchReservations.payloadExpiresAt),
        gt(watchDispatchReservations.payloadExpiresAt, now),
      ),
    ));
    await tx.update(watchDispatchReservations).set({
      status: "failed",
      handoffPayload: null,
      payloadExpiresAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchDispatchReservations.id, reservationId),
      eq(watchDispatchReservations.status, "dispatching"),
      eq(watchDispatchReservations.leaseToken, claimToken),
      or(
        sql`${watchDispatchReservations.attempts} >= ${WATCH_DISPATCH_MAX_ATTEMPTS}`,
        lte(watchDispatchReservations.payloadExpiresAt, now),
        and(
          ne(watchDispatchReservations.handoffKind, "scheduled"),
          isNull(watchDispatchReservations.handoffPayload),
        ),
      ),
    ));
  }));
}

export async function prepareWatchProviderDelivery(input: {
  reservationId: string;
  dispatchClaimToken: string;
  callId: string;
  sessionId: string;
  turnId: string;
  content: string;
}, context: WatchServiceContext): Promise<WatchProviderDelivery> {
  const reservationId = reservationIdSchema.parse(input.reservationId);
  const callId = identifierSchema.parse(input.callId);
  identifierSchema.parse(input.sessionId);
  identifierSchema.parse(input.turnId);
  const content = deliveryContentSchema.parse(input.content);
  const dispatchClaimToken = z.string().uuid().parse(input.dispatchClaimToken);
  const runtime = await resolveWatchRuntimeContext(reservationId, context, {
    claimToken: dispatchClaimToken,
  });
  if (!runtime.capabilityGrants.includes("provider.deliver")) {
    throw new WatchRuntimeError(
      "delivery-unavailable",
      "The effective watch revision does not grant provider delivery.",
    );
  }
  if (runtime.source.provider !== "slack" || runtime.source.resource.type !== "channel") {
    throw new WatchRuntimeError(
      "destination-unavailable",
      "The current watch runtime has no supported source-bound delivery destination.",
    );
  }
  const mode = deliveryMode(runtime.delivery);
  if (mode === "silent") {
    throw new WatchRuntimeError(
      "delivery-unavailable",
      "The effective watch revision requires silent delivery.",
    );
  }
  const id = hash(["watch-provider-delivery", reservationId, callId]);
  const contentHash = hash([content]);
  const clientMessageId = uuidFromHash(hash(["watch-provider-message", id]));
  const now = (context.now ?? new Date()).toISOString();
  const policyExpiry = new Date(runtime.expiresAt).getTime();
  const expiresAt = new Date(Math.min(
    new Date(now).getTime() + 7 * 86_400_000,
    policyExpiry,
  )).toISOString();
  try {
    return await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
      const inserted = await tx.insert(watchProviderDeliveries).values({
        id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        watchId: runtime.watchId,
        effectiveRevisionId: runtime.effectiveRevisionId,
        reservationId,
        dispatchClaimToken,
        provider: "slack",
        providerWorkspaceId: runtime.providerWorkspaceId,
        resourceType: "channel",
        resourceId: runtime.source.resource.id,
        mode,
        digestBatchId: null,
        status: "pending",
        content,
        contentHash,
        clientMessageId,
        attempts: 0,
        leaseExpiresAt: null,
        leaseToken: null,
        createdAt: now,
        expiresAt,
        updatedAt: now,
        deliveredAt: null,
      }).onConflictDoNothing().returning({ id: watchProviderDeliveries.id });
      if (inserted[0] !== undefined) {
        const dayBucket = utcDayBucket(new Date(now));
        const bucketId = hash([
          "watch-delivery-budget",
          DEFAULT_WORKSPACE_ID,
          runtime.effectiveRevisionId,
          dayBucket,
        ]);
        await tx.insert(watchDeliveryBudgetBuckets).values({
          id: bucketId,
          workspaceId: DEFAULT_WORKSPACE_ID,
          watchId: runtime.watchId,
          effectiveRevisionId: runtime.effectiveRevisionId,
          dayBucket,
          reservedDeliveries: 0,
          limitSnapshot: runtime.deliveriesPerDay,
          updatedAt: now,
        }).onConflictDoNothing();
        const reserved = await tx.update(watchDeliveryBudgetBuckets).set({
          reservedDeliveries: sql`${watchDeliveryBudgetBuckets.reservedDeliveries} + 1`,
          updatedAt: now,
        }).where(and(
          eq(watchDeliveryBudgetBuckets.id, bucketId),
          eq(watchDeliveryBudgetBuckets.limitSnapshot, runtime.deliveriesPerDay),
          lt(watchDeliveryBudgetBuckets.reservedDeliveries, runtime.deliveriesPerDay),
        )).returning({ reservedDeliveries: watchDeliveryBudgetBuckets.reservedDeliveries });
        if (reserved[0] === undefined) {
          throw new WatchRuntimeError(
            "budget-exhausted",
            "The watch delivery budget is exhausted for the current UTC day.",
          );
        }
      }
      const rows = await tx.select().from(watchProviderDeliveries).where(and(
        eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchProviderDeliveries.id, id),
      )).limit(1);
      const row = rows[0];
      if (
        row === undefined || row.reservationId !== reservationId ||
        row.contentHash !== contentHash || row.mode !== mode
      ) {
        throw new WatchRuntimeError(
          "storage-unavailable",
          "The replayed provider delivery does not match its original request.",
        );
      }
      return projectDelivery(row);
    }));
  } catch (error) {
    if (error instanceof WatchRuntimeError) throw error;
    throw new WatchRuntimeError(
      "storage-unavailable",
      "Provider delivery could not be prepared durably.",
      { cause: error },
    );
  }
}

export async function claimImmediateWatchProviderDelivery(
  deliveryIdInput: string,
  reservationIdInput: string,
  context: WatchServiceContext,
): Promise<PreparedWatchProviderDelivery | null> {
  const deliveryId = z.string().regex(/^[a-f0-9]{64}$/u).parse(deliveryIdInput);
  const reservationId = reservationIdSchema.parse(reservationIdInput);
  const now = context.now ?? new Date();
  const initialRows = await withDocsAgentDatabase((db) => db.select()
    .from(watchProviderDeliveries).where(and(
      eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchProviderDeliveries.id, deliveryId),
      eq(watchProviderDeliveries.reservationId, reservationId),
    )).limit(1));
  const initial = initialRows[0];
  if (initial?.status === "sent") return null;
  if (initial?.status === "failed") {
    throw new WatchRuntimeError("retry-exhausted", "Provider delivery retry budget is exhausted.");
  }
  if (initial === undefined) throw authorityUnavailable();
  const runtime = await resolveWatchRuntimeContext(reservationId, context, {
    claimToken: initial.dispatchClaimToken,
    allowTerminal: true,
  });
  const claimToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + WATCH_DELIVERY_LEASE_MS).toISOString();
  const staleBefore = now.toISOString();
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const rows = await tx.select().from(watchProviderDeliveries).where(and(
      eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchProviderDeliveries.id, deliveryId),
    )).limit(1);
    const row = rows[0];
    if (row?.status === "sent") return null;
    if (row?.status === "failed") {
      throw new WatchRuntimeError("retry-exhausted", "Provider delivery retry budget is exhausted.");
    }
    if (
      row === undefined || row.reservationId !== reservationId ||
      row.dispatchClaimToken !== initial.dispatchClaimToken ||
      row.watchId !== runtime.watchId ||
      row.effectiveRevisionId !== runtime.effectiveRevisionId ||
      row.provider !== runtime.source.provider ||
      row.providerWorkspaceId !== runtime.providerWorkspaceId ||
      row.resourceType !== runtime.source.resource.type ||
      row.resourceId !== runtime.source.resource.id ||
      row.mode !== "immediate" ||
      !(row.status === "pending" ||
        row.status === "sending" && row.leaseExpiresAt !== null &&
          row.leaseExpiresAt <= staleBefore) ||
      row.content === null ||
      now.getTime() >= new Date(row.expiresAt).getTime()
    ) throw authorityUnavailable();
    if (row.attempts >= WATCH_DELIVERY_MAX_ATTEMPTS) {
      throw new WatchRuntimeError("retry-exhausted", "Provider delivery retry budget is exhausted.");
    }
    const updated = await tx.update(watchProviderDeliveries).set({
      status: "sending",
      attempts: row.attempts + 1,
      leaseExpiresAt,
      leaseToken: claimToken,
      updatedAt: now.toISOString(),
    }).where(and(
      eq(watchProviderDeliveries.id, row.id),
      eq(watchProviderDeliveries.status, row.status),
      eq(watchProviderDeliveries.attempts, row.attempts),
      row.status !== "sending"
        ? undefined
        : row.leaseToken === null
          ? isNull(watchProviderDeliveries.leaseToken)
          : eq(watchProviderDeliveries.leaseToken, row.leaseToken),
    )).returning();
    if (updated[0] === undefined) return null;
    return preparedWatchProviderDeliverySchema.parse({
      deliveryIds: [row.id],
      reservationId,
      provider: row.provider,
      providerWorkspaceId: row.providerWorkspaceId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      mode: row.mode,
      clientMessageId: row.clientMessageId,
      claimToken,
      content: row.content,
    });
  }));
}

export async function claimPendingImmediateWatchProviderDeliveries(
  context: WatchServiceContext,
  options: { limit?: number } = {},
): Promise<readonly PreparedWatchProviderDelivery[]> {
  await requireWatchServiceReady(context);
  const now = context.now ?? new Date();
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 25);
  const candidates = await withDocsAgentDatabase((db) => db.select({
    id: watchProviderDeliveries.id,
    reservationId: watchProviderDeliveries.reservationId,
  }).from(watchProviderDeliveries).where(and(
    eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(watchProviderDeliveries.mode, "immediate"),
    lt(watchProviderDeliveries.attempts, WATCH_DELIVERY_MAX_ATTEMPTS),
    gt(watchProviderDeliveries.expiresAt, now.toISOString()),
    or(
      eq(watchProviderDeliveries.status, "pending"),
      and(
        eq(watchProviderDeliveries.status, "sending"),
        lte(watchProviderDeliveries.leaseExpiresAt, now.toISOString()),
      ),
    ),
  )).orderBy(
    asc(watchProviderDeliveries.createdAt),
    asc(watchProviderDeliveries.id),
  ).limit(limit));
  const claimed: PreparedWatchProviderDelivery[] = [];
  for (const candidate of candidates) {
    try {
      const delivery = await claimImmediateWatchProviderDelivery(
        candidate.id,
        candidate.reservationId,
        { ...context, now },
      );
      if (delivery !== null) claimed.push(delivery);
    } catch (error) {
      if (error instanceof WatchRuntimeError && error.code === "authority-unavailable" ||
        error instanceof WatchDispatchReadinessError && error.code === "authority-unavailable") {
        await terminallyFailWatchProviderDeliveries([candidate.id], now);
        continue;
      }
      throw error;
    }
  }
  return claimed;
}

export async function claimDueWatchDigestDeliveries(
  context: WatchServiceContext,
  options: { limit?: number; scanLimit?: number } = {},
): Promise<readonly PreparedWatchProviderDelivery[]> {
  await requireWatchServiceReady(context);
  const now = context.now ?? new Date();
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 25);
  const scanLimit = z.number().int().min(limit).max(500).parse(options.scanLimit ?? 500);
  const rows = await withDocsAgentDatabase((db) => db.select({
    delivery: watchProviderDeliveries,
    lifecycleState: policyBoundWatches.lifecycleState,
    currentEffectiveRevisionId: policyBoundWatches.effectiveRevisionId,
    policy: watchEffectiveRevisions.policy,
  }).from(watchProviderDeliveries).innerJoin(
    policyBoundWatches,
    and(
      eq(policyBoundWatches.id, watchProviderDeliveries.watchId),
      eq(policyBoundWatches.workspaceId, watchProviderDeliveries.workspaceId),
    ),
  ).innerJoin(
    watchEffectiveRevisions,
    and(
      eq(watchEffectiveRevisions.id, watchProviderDeliveries.effectiveRevisionId),
      eq(watchEffectiveRevisions.watchId, watchProviderDeliveries.watchId),
      eq(watchEffectiveRevisions.workspaceId, watchProviderDeliveries.workspaceId),
    ),
  ).where(and(
    eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(watchProviderDeliveries.mode, "digest"),
    lt(watchProviderDeliveries.attempts, WATCH_DELIVERY_MAX_ATTEMPTS),
    gt(watchProviderDeliveries.expiresAt, now.toISOString()),
    or(
      eq(watchProviderDeliveries.status, "pending"),
      and(
        eq(watchProviderDeliveries.status, "sending"),
        lte(watchProviderDeliveries.leaseExpiresAt, now.toISOString()),
      ),
    ),
  )).orderBy(
    asc(watchProviderDeliveries.createdAt),
    asc(watchProviderDeliveries.id),
  ).limit(scanLimit + 1));
  if (rows.length > scanLimit) {
    throw new WatchRuntimeError(
      "runtime-capacity-exceeded",
      `The watch digest dispatcher supports at most ${scanLimit} eligible rows per tick.`,
    );
  }
  const groups = new Map<string, typeof rows>();
  const failedBatchIds = new Set<string>();
  for (const row of rows) {
    const revision = effectiveWatchRevisionSchema.shape.policy.safeParse(row.policy);
    if (
      !revision.success || row.lifecycleState !== "active" ||
      row.currentEffectiveRevisionId !== row.delivery.effectiveRevisionId ||
      revision.data.source.provider !== row.delivery.provider ||
      revision.data.source.providerWorkspaceId !== row.delivery.providerWorkspaceId ||
      revision.data.source.resource.type !== row.delivery.resourceType ||
      revision.data.source.resource.id !== row.delivery.resourceId ||
      !revision.data.capabilityGrants.includes("provider.deliver") ||
      revision.data.delivery.mode !== "digest"
    ) {
      if (row.delivery.digestBatchId === null) {
        await terminallyFailWatchProviderDeliveries([row.delivery.id], now);
      } else {
        await terminallyFailWatchProviderDigestBatch(row.delivery.digestBatchId, now);
        failedBatchIds.add(row.delivery.digestBatchId);
      }
      continue;
    }
    if (
      row.delivery.digestBatchId !== null &&
      failedBatchIds.has(row.delivery.digestBatchId)
    ) continue;
    if (!cronMatches(
      revision.data.delivery.schedule.cron,
      revision.data.delivery.schedule.timeZone,
      now,
    )) continue;
    const key = JSON.stringify([
      row.delivery.watchId,
      row.delivery.effectiveRevisionId,
      row.delivery.providerWorkspaceId,
      row.delivery.resourceId,
      row.delivery.digestBatchId,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const prepared: PreparedWatchProviderDelivery[] = [];
  for (const group of [...groups.values()].slice(0, limit)) {
    const existingBatchId = group[0]?.delivery.digestBatchId ?? null;
    if (existingBatchId !== null && failedBatchIds.has(existingBatchId)) continue;
    const selected: typeof group = [];
    let contentLength = 0;
    let batchUnavailable = false;
    for (const candidate of existingBatchId === null ? group.slice(0, 100) : group) {
      const candidateContent = candidate.delivery.content;
      if (candidateContent === null) {
        if (existingBatchId === null) {
          await terminallyFailWatchProviderDeliveries([candidate.delivery.id], now);
        } else {
          await terminallyFailWatchProviderDigestBatch(existingBatchId, now);
          failedBatchIds.add(existingBatchId);
          batchUnavailable = true;
          break;
        }
        continue;
      }
      const nextLength = contentLength + (selected.length === 0 ? 0 : 9) +
        candidateContent.length;
      if (nextLength > 12_000) {
        if (existingBatchId !== null) {
          throw new WatchRuntimeError(
            "storage-unavailable",
            "A durable watch digest batch no longer fits its recorded delivery contract.",
          );
        }
        break;
      }
      selected.push(candidate);
      contentLength = nextLength;
    }
    if (batchUnavailable || selected.length === 0) continue;
    const first = selected[0]!.delivery;
    const content = selected.map(({ delivery }) => delivery.content!)
      .join("\n\n---\n\n").trim();
    if (content.length === 0) continue;
    const deliveryIds = selected.map(({ delivery }) => delivery.id).sort();
    const batchId = existingBatchId ?? hash(["watch-digest-batch", ...deliveryIds]);
    let authorized = true;
    for (const { delivery } of selected) {
      try {
        await resolveWatchRuntimeContext(delivery.reservationId, context, {
          claimToken: delivery.dispatchClaimToken,
          allowTerminal: true,
        });
      } catch (error) {
        const unavailable = error instanceof WatchRuntimeError &&
            error.code === "authority-unavailable" ||
          error instanceof WatchDispatchReadinessError &&
            error.code === "authority-unavailable";
        if (!unavailable) throw error;
        if (existingBatchId === null) {
          await terminallyFailWatchProviderDeliveries([delivery.id], now);
        } else {
          await terminallyFailWatchProviderDigestBatch(existingBatchId, now);
          failedBatchIds.add(existingBatchId);
        }
        authorized = false;
        if (existingBatchId !== null) break;
      }
    }
    if (!authorized) continue;
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + WATCH_DELIVERY_LEASE_MS).toISOString();
    try {
      await withDocsAgentDatabase((db) => db.transaction(async (tx) => {
        const claimed = await tx.update(watchProviderDeliveries).set({
          digestBatchId: batchId,
          status: "sending",
          attempts: sql`${watchProviderDeliveries.attempts} + 1`,
          leaseExpiresAt,
          leaseToken: claimToken,
          updatedAt: now.toISOString(),
        }).where(and(
          eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
          inArray(watchProviderDeliveries.id, deliveryIds),
          existingBatchId === null
            ? isNull(watchProviderDeliveries.digestBatchId)
            : eq(watchProviderDeliveries.digestBatchId, existingBatchId),
          lt(watchProviderDeliveries.attempts, WATCH_DELIVERY_MAX_ATTEMPTS),
          or(
            eq(watchProviderDeliveries.status, "pending"),
            and(
              eq(watchProviderDeliveries.status, "sending"),
              lte(watchProviderDeliveries.leaseExpiresAt, now.toISOString()),
            ),
          ),
        )).returning({ id: watchProviderDeliveries.id });
        if (claimed.length !== deliveryIds.length) throw new ConcurrentDeliveryClaim();
      }));
    } catch (error) {
      if (error instanceof ConcurrentDeliveryClaim) continue;
      throw error;
    }
    prepared.push(preparedWatchProviderDeliverySchema.parse({
      deliveryIds,
      reservationId: first.reservationId,
      provider: first.provider,
      providerWorkspaceId: first.providerWorkspaceId,
      resourceType: first.resourceType,
      resourceId: first.resourceId,
      mode: "digest",
      clientMessageId: uuidFromHash(hash(["watch-digest", batchId])),
      claimToken,
      content,
    }));
  }
  return prepared;
}

export async function completeWatchProviderDelivery(
  input: PreparedWatchProviderDelivery,
): Promise<void> {
  const parsed = preparedWatchProviderDeliverySchema.parse(input);
  const now = new Date().toISOString();
  await withDocsAgentDatabase((db) => db.update(watchProviderDeliveries).set({
    status: "sent",
    content: null,
    leaseExpiresAt: null,
    leaseToken: null,
    deliveredAt: now,
    updatedAt: now,
  }).where(and(
    eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
    inArray(watchProviderDeliveries.id, parsed.deliveryIds),
    eq(watchProviderDeliveries.status, "sending"),
    eq(watchProviderDeliveries.leaseToken, parsed.claimToken),
  )));
}

export async function failWatchProviderDelivery(
  input: PreparedWatchProviderDelivery,
): Promise<void> {
  const parsed = preparedWatchProviderDeliverySchema.parse(input);
  const now = new Date().toISOString();
  await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await tx.update(watchProviderDeliveries).set({
      status: "pending",
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
      inArray(watchProviderDeliveries.id, parsed.deliveryIds),
      eq(watchProviderDeliveries.status, "sending"),
      eq(watchProviderDeliveries.leaseToken, parsed.claimToken),
      lt(watchProviderDeliveries.attempts, WATCH_DELIVERY_MAX_ATTEMPTS),
    ));
    await tx.update(watchProviderDeliveries).set({
      status: "failed",
      content: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
      inArray(watchProviderDeliveries.id, parsed.deliveryIds),
      eq(watchProviderDeliveries.status, "sending"),
      eq(watchProviderDeliveries.leaseToken, parsed.claimToken),
      sql`${watchProviderDeliveries.attempts} >= ${WATCH_DELIVERY_MAX_ATTEMPTS}`,
    ));
  }));
}

async function terminallyFailWatchProviderDeliveries(
  deliveryIds: readonly string[],
  now: Date,
): Promise<void> {
  await withDocsAgentDatabase((db) => db.update(watchProviderDeliveries).set({
    status: "failed",
    content: null,
    leaseExpiresAt: null,
    leaseToken: null,
    updatedAt: now.toISOString(),
  }).where(and(
    eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
    inArray(watchProviderDeliveries.id, [...deliveryIds]),
    inArray(watchProviderDeliveries.status, ["pending", "sending"]),
  )));
}

async function terminallyFailWatchProviderDigestBatch(
  digestBatchId: string,
  now: Date,
): Promise<void> {
  await withDocsAgentDatabase((db) => db.update(watchProviderDeliveries).set({
    status: "failed",
    content: null,
    leaseExpiresAt: null,
    leaseToken: null,
    updatedAt: now.toISOString(),
  }).where(and(
    eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(watchProviderDeliveries.mode, "digest"),
    eq(watchProviderDeliveries.digestBatchId, identifierSchema.parse(digestBatchId)),
    inArray(watchProviderDeliveries.status, ["pending", "sending"]),
  )));
}

export async function expireWatchRuntimeData(nowInput = new Date()): Promise<{
  expiredDispatches: number;
  expiredDeliveries: number;
  deletedOutcomes: number;
}> {
  const now = nowInput.toISOString();
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const expiredDispatches = await tx.update(watchDispatchReservations).set({
      status: "failed",
      handoffPayload: null,
      payloadExpiresAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      inArray(watchDispatchReservations.status, ["ready", "dispatching"]),
      lte(watchDispatchReservations.payloadExpiresAt, now),
    )).returning({ id: watchDispatchReservations.id });
    const exhaustedDispatches = await tx.update(watchDispatchReservations).set({
      status: "failed",
      handoffPayload: null,
      payloadExpiresAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchDispatchReservations.status, "dispatching"),
      sql`${watchDispatchReservations.attempts} >= ${WATCH_DISPATCH_MAX_ATTEMPTS}`,
      lte(watchDispatchReservations.leaseExpiresAt, now),
    )).returning({ id: watchDispatchReservations.id });
    const expired = await tx.update(watchProviderDeliveries).set({
      status: "failed",
      content: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
      inArray(watchProviderDeliveries.status, ["pending", "sending"]),
      lte(watchProviderDeliveries.expiresAt, now),
    )).returning({ id: watchProviderDeliveries.id });
    const exhaustedDeliveries = await tx.update(watchProviderDeliveries).set({
      status: "failed",
      content: null,
      leaseExpiresAt: null,
      leaseToken: null,
      updatedAt: now,
    }).where(and(
      eq(watchProviderDeliveries.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchProviderDeliveries.status, "sending"),
      sql`${watchProviderDeliveries.attempts} >= ${WATCH_DELIVERY_MAX_ATTEMPTS}`,
      lte(watchProviderDeliveries.leaseExpiresAt, now),
    )).returning({ id: watchProviderDeliveries.id });
    const deleted = await tx.delete(watchActionOutcomes).where(and(
      eq(watchActionOutcomes.workspaceId, DEFAULT_WORKSPACE_ID),
      lte(watchActionOutcomes.expiresAt, now),
    )).returning({ id: watchActionOutcomes.id });
    return {
      expiredDispatches: expiredDispatches.length + exhaustedDispatches.length,
      expiredDeliveries: expired.length + exhaustedDeliveries.length,
      deletedOutcomes: deleted.length,
    };
  }));
}

export async function recordWatchActionOutcome(input: {
  reservationId: string;
  claimToken: string;
  sessionId: string;
  turnId: string;
  actionKey: string;
  action: string;
  status: "succeeded" | "failed" | "rejected";
  resultCode?: string;
}): Promise<void> {
  await recordOutcome({
    ...input,
    capabilityFamily: capabilityForAction(input.action),
  });
}

export async function recordWatchTerminalOutcome(input: {
  reservationId: string;
  claimToken: string;
  sessionId: string;
  turnId: string;
  status: "succeeded" | "failed";
  resultCode?: string;
}): Promise<void> {
  const reservationId = reservationIdSchema.parse(input.reservationId);
  const claimToken = z.string().uuid().parse(input.claimToken);
  const sessionId = identifierSchema.parse(input.sessionId);
  const turnId = identifierSchema.parse(input.turnId);
  await withDocsAgentDatabase((db) => db.transaction(async (tx) => {
    const rows = await tx.select({ actionKey: watchActionOutcomes.actionKey }).from(watchActionOutcomes)
      .where(and(
        eq(watchActionOutcomes.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchActionOutcomes.reservationId, reservationId),
        eq(watchActionOutcomes.sessionId, sessionId),
        eq(watchActionOutcomes.turnId, turnId),
      ));
    const actionCount = rows.filter(({ actionKey }) => actionKey !== "terminal").length;
    await recordOutcomeInTransaction(tx, {
      reservationId,
      claimToken,
      sessionId,
      turnId,
      actionKey: "terminal",
      action: input.status === "succeeded" && actionCount === 0 ? "no-op" : "turn",
      capabilityFamily: null,
      status: input.status === "succeeded" && actionCount === 0 ? "no-op" : input.status,
      resultCode: input.resultCode,
    });
    const now = new Date().toISOString();
    const updated = await tx.update(watchDispatchReservations).set({
      status: input.status === "succeeded" ? "completed" : "failed",
      handoffPayload: null,
      payloadExpiresAt: null,
      leaseExpiresAt: null,
      sessionId,
      updatedAt: now,
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchDispatchReservations.id, reservationId),
      eq(watchDispatchReservations.leaseToken, claimToken),
      or(
        eq(watchDispatchReservations.status, "dispatching"),
        and(
          eq(watchDispatchReservations.status, "dispatched"),
          eq(watchDispatchReservations.sessionId, sessionId),
        ),
      ),
    )).returning({ id: watchDispatchReservations.id });
    if (updated[0] === undefined) throw authorityUnavailable();
  }));
}

export function cronMatches(cron: string, timeZone: string, now: Date): boolean {
  try {
    if (cron.trim().split(/\s+/u).length !== 5) return false;
    const minute = new Date(now);
    minute.setUTCSeconds(0, 0);
    const previous = new Date(minute.getTime() - 1);
    const next = CronExpressionParser.parse(cron, {
      currentDate: previous,
      tz: timeZone,
      hashSeed: cron,
    }).next().toDate();
    return next.getTime() === minute.getTime();
  } catch {
    return false;
  }
}

function cronOccurrenceKey(timeZone: string, now: Date): string {
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  return `${minute.toISOString()}@${timeZone}`;
}

async function reserveScheduledDispatch(
  revision: EffectiveWatchRevision,
  reservationId: string,
  occurrenceKey: string,
  preparedAt: string,
): Promise<ScheduledWatchDispatch | null> {
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const inserted = await tx.insert(watchDispatchReservations).values({
      id: reservationId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      watchId: revision.watchId,
      effectiveRevisionId: revision.id,
      provider: revision.policy.source.provider,
      providerWorkspaceId: revision.policy.source.providerWorkspaceId,
      resourceType: revision.policy.source.resource.type,
      resourceId: revision.policy.source.resource.id,
      handoffKind: "scheduled",
      handoffPayload: null,
      payloadExpiresAt: null,
      claimIds: [],
      observationCount: 0,
      characterCount: 0,
      hourBucket: utcHourBucket(new Date(preparedAt)),
      status: "ready",
      attempts: 0,
      leaseExpiresAt: null,
      leaseToken: null,
      sessionId: null,
      reservedAt: preparedAt,
      updatedAt: preparedAt,
    }).onConflictDoNothing().returning({ id: watchDispatchReservations.id });
    if (inserted[0] === undefined) return null;
    const limit = revision.policy.budgets.processingRunsPerHour;
    const hourBucket = utcHourBucket(new Date(preparedAt));
    const bucketId = hash(["watch-processing-budget", DEFAULT_WORKSPACE_ID, revision.id, hourBucket]);
    await tx.insert(watchProcessingBudgetBuckets).values({
      id: bucketId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      watchId: revision.watchId,
      effectiveRevisionId: revision.id,
      hourBucket,
      reservedRuns: 0,
      limitSnapshot: limit,
      updatedAt: preparedAt,
    }).onConflictDoNothing();
    const reserved = await tx.update(watchProcessingBudgetBuckets).set({
      reservedRuns: sql`${watchProcessingBudgetBuckets.reservedRuns} + 1`,
      updatedAt: preparedAt,
    }).where(and(
      eq(watchProcessingBudgetBuckets.id, bucketId),
      eq(watchProcessingBudgetBuckets.limitSnapshot, limit),
      lt(watchProcessingBudgetBuckets.reservedRuns, limit),
    )).returning({ reservedRuns: watchProcessingBudgetBuckets.reservedRuns });
    if (reserved[0] === undefined) {
      throw new WatchRuntimeError("budget-exhausted", "Scheduled watch processing budget is exhausted.");
    }
    return scheduledWatchDispatchSchema.parse({
      reservation: {
        id: reservationId,
        replayed: false,
        hourBucket,
        reservedAt: preparedAt,
      },
      effectiveRevision: revision,
      occurrenceKey,
      preparedAt,
    });
  }));
}

async function claimWatchTurnDispatchRow(
  reservationId: string,
  now: Date,
): Promise<ClaimedWatchTurnDispatch | null> {
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const leaseExpiresAt = new Date(now.getTime() + WATCH_DISPATCH_LEASE_MS).toISOString();
    const claimToken = randomUUID();
    const claimed = await tx.update(watchDispatchReservations).set({
      status: "dispatching",
      attempts: sql`${watchDispatchReservations.attempts} + 1`,
      leaseExpiresAt: sql`CASE
        WHEN ${watchDispatchReservations.payloadExpiresAt} IS NOT NULL
          AND ${watchDispatchReservations.payloadExpiresAt} < ${leaseExpiresAt}
        THEN ${watchDispatchReservations.payloadExpiresAt}
        ELSE ${leaseExpiresAt}
      END`,
      leaseToken: claimToken,
      updatedAt: now.toISOString(),
    }).where(and(
      eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchDispatchReservations.id, reservationId),
      lt(watchDispatchReservations.attempts, WATCH_DISPATCH_MAX_ATTEMPTS),
      or(
        eq(watchDispatchReservations.status, "ready"),
        and(
          eq(watchDispatchReservations.status, "dispatching"),
          lte(watchDispatchReservations.leaseExpiresAt, now.toISOString()),
        ),
      ),
      or(
        eq(watchDispatchReservations.handoffKind, "scheduled"),
        isNotNull(watchDispatchReservations.handoffPayload),
      ),
      or(
        isNull(watchDispatchReservations.payloadExpiresAt),
        gt(watchDispatchReservations.payloadExpiresAt, now.toISOString()),
      ),
    )).returning();
    const row = claimed[0];
    if (row === undefined) return null;
    const revisions = await tx.select().from(watchEffectiveRevisions).where(and(
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchEffectiveRevisions.id, row.effectiveRevisionId),
      eq(watchEffectiveRevisions.watchId, row.watchId),
    )).limit(1);
    const revisionRow = revisions[0];
    const revision = effectiveWatchRevisionSchema.safeParse(revisionRow === undefined
      ? undefined
      : {
          id: revisionRow.id,
          watchId: revisionRow.watchId,
          proposalRevisionId: revisionRow.proposalRevisionId,
          contractVersion: revisionRow.contractVersion,
          policy: revisionRow.policy,
          approvedBy: {
            id: revisionRow.approvedById,
            githubLogin: revisionRow.approvedByLogin,
          },
          approvedAt: revisionRow.approvedAt,
        });
    if (!revision.success) throw authorityUnavailable();
    const reservation = watchDispatchReservationSchema.parse({
      id: row.id,
      replayed: row.attempts > 0,
      hourBucket: row.hourBucket,
      reservedAt: row.reservedAt,
    });
    if (row.handoffKind === "scheduled") {
      return {
        claimToken,
        dispatch: scheduledWatchDispatchSchema.parse({
          reservation,
          effectiveRevision: revision.data,
          occurrenceKey: row.id,
          preparedAt: now.toISOString(),
        }),
      };
    }
    const handoff = watchObservationHandoffSchema.safeParse(row.handoffPayload);
    if (!handoff.success) throw authorityUnavailable();
    return {
      claimToken,
      dispatch: watchDispatchReadyHandoffSchema.parse({
        reservation,
        effectiveRevision: revision.data,
        handoff: handoff.data,
        preparedAt: now.toISOString(),
      }),
    };
  }));
}

async function claimEphemeralWatchTurnDispatchRow(
  dispatch: WatchDispatchReadyHandoff,
  now: Date,
): Promise<ClaimedWatchTurnDispatch | null> {
  if (dispatch.preparedAt !== dispatch.reservation.reservedAt) return null;
  const claimToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + WATCH_DISPATCH_LEASE_MS).toISOString();
  const claimDeadline = new Date(Math.min(
    new Date(dispatch.reservation.reservedAt).getTime() + WATCH_EPHEMERAL_DISPATCH_CLAIM_MS,
    new Date(dispatch.effectiveRevision.policy.expiresAt!).getTime(),
  )).toISOString();
  const claimed = await withDocsAgentDatabase((db) => db.update(
    watchDispatchReservations,
  ).set({
    status: "dispatching",
    attempts: sql`${watchDispatchReservations.attempts} + 1`,
    leaseExpiresAt,
    leaseToken: claimToken,
    updatedAt: now.toISOString(),
  }).where(and(
    eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(watchDispatchReservations.id, dispatch.reservation.id),
    eq(watchDispatchReservations.watchId, dispatch.effectiveRevision.watchId),
    eq(watchDispatchReservations.effectiveRevisionId, dispatch.effectiveRevision.id),
    eq(watchDispatchReservations.provider, dispatch.handoff.source.provider),
    eq(
      watchDispatchReservations.providerWorkspaceId,
      dispatch.handoff.observations[0]!.provenance.providerWorkspaceId,
    ),
    eq(watchDispatchReservations.resourceType, dispatch.handoff.source.resource.type),
    eq(watchDispatchReservations.resourceId, dispatch.handoff.source.resource.id),
    eq(watchDispatchReservations.handoffKind, dispatch.handoff.kind),
    eq(watchDispatchReservations.status, "ready"),
    eq(watchDispatchReservations.attempts, 0),
    eq(watchDispatchReservations.reservedAt, dispatch.reservation.reservedAt),
    eq(watchDispatchReservations.payloadExpiresAt, claimDeadline),
    gt(watchDispatchReservations.payloadExpiresAt, now.toISOString()),
    isNull(watchDispatchReservations.handoffPayload),
  )).returning({ id: watchDispatchReservations.id }));
  if (claimed[0] === undefined) return null;
  return { claimToken, dispatch };
}

async function recordOutcome(input: {
  reservationId: string;
  claimToken: string;
  sessionId: string;
  turnId: string;
  actionKey: string;
  action: string;
  capabilityFamily: CapabilityFamily | null;
  status: "succeeded" | "failed" | "rejected" | "no-op";
  resultCode?: string;
}): Promise<void> {
  await withDocsAgentDatabase((db) => db.transaction((tx) =>
    recordOutcomeInTransaction(tx, input)
  ));
}

async function recordOutcomeInTransaction(
  tx: WatchOutcomeDatabase,
  input: {
    reservationId: string;
    claimToken: string;
    sessionId: string;
    turnId: string;
    actionKey: string;
    action: string;
    capabilityFamily: CapabilityFamily | null;
    status: "succeeded" | "failed" | "rejected" | "no-op";
    resultCode?: string;
  },
): Promise<void> {
  const reservationId = reservationIdSchema.parse(input.reservationId);
  const claimToken = z.string().uuid().parse(input.claimToken);
  const occurredAt = new Date().toISOString();
  const rows = await tx.select({
    watchId: watchDispatchReservations.watchId,
    effectiveRevisionId: watchDispatchReservations.effectiveRevisionId,
    policy: watchEffectiveRevisions.policy,
    reservationClaimToken: watchDispatchReservations.leaseToken,
    reservationStatus: watchDispatchReservations.status,
  }).from(watchDispatchReservations).innerJoin(
    watchEffectiveRevisions,
    and(
      eq(watchEffectiveRevisions.id, watchDispatchReservations.effectiveRevisionId),
      eq(watchEffectiveRevisions.watchId, watchDispatchReservations.watchId),
    ),
  ).where(and(
    eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(watchDispatchReservations.id, reservationId),
  )).limit(1);
  const row = rows[0];
  const policy = effectiveWatchRevisionSchema.shape.policy.safeParse(row?.policy);
  if (
    row === undefined || !policy.success ||
    row.reservationClaimToken !== claimToken ||
    !["dispatching", "dispatched"].includes(row.reservationStatus)
  ) throw authorityUnavailable();
  const expiresAt = new Date(
    new Date(occurredAt).getTime() + policy.data.retention.auditDays * 86_400_000,
  ).toISOString();
  const actionKey = identifierSchema.parse(input.actionKey);
  await tx.insert(watchActionOutcomes).values({
    id: hash(["watch-action-outcome", reservationId, actionKey]),
    workspaceId: DEFAULT_WORKSPACE_ID,
    watchId: row.watchId,
    effectiveRevisionId: row.effectiveRevisionId,
    reservationId,
    sessionId: identifierSchema.parse(input.sessionId),
    turnId: identifierSchema.parse(input.turnId),
    actionKey,
    action: identifierSchema.parse(input.action),
    capabilityFamily: input.capabilityFamily,
    status: input.status,
    resultCode: input.resultCode === undefined
      ? null
      : z.string().trim().min(1).max(100).parse(input.resultCode),
    occurredAt,
    expiresAt,
  }).onConflictDoNothing();
}

function projectDelivery(row: typeof watchProviderDeliveries.$inferSelect): WatchProviderDelivery {
  return watchProviderDeliverySchema.parse({
    id: row.id,
    reservationId: row.reservationId,
    provider: row.provider,
    providerWorkspaceId: row.providerWorkspaceId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    mode: row.mode,
    status: row.status,
    clientMessageId: row.clientMessageId,
    content: row.content,
    attempts: row.attempts,
  });
}

function deliveryMode(value: unknown): "immediate" | "digest" | "silent" {
  const result = z.object({ mode: z.enum(["immediate", "digest", "silent"]) })
    .passthrough().safeParse(value);
  if (!result.success) throw authorityUnavailable();
  return result.data.mode;
}

function capabilityForAction(action: string): CapabilityFamily | null {
  const map: Record<string, CapabilityFamily> = {
    workspace_knowledge: "knowledge.read",
    web_fetch: "knowledge.read",
    web_search: "knowledge.read",
    working_repository: "repository.read",
    get_docs_profile: "repository.read",
    docs_work_read: "docs_work.manage",
    docs_work_manage: "docs_work.manage",
    internal_document: "docs_work.manage",
    authoring_workspace: "draft.edit",
    docs_follow_up: "follow_up.schedule",
    provider_delivery: "provider.deliver",
  };
  return map[action] ?? null;
}

function authorityUnavailable(): WatchRuntimeError {
  return new WatchRuntimeError(
    "authority-unavailable",
    "The watch dispatch reservation no longer has exact current authority.",
  );
}

function utcHourBucket(now: Date): string {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

function utcDayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function uuidFromHash(value: string): string {
  const hex = value.slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .map((part) => part.join(""))
    .join("-");
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
