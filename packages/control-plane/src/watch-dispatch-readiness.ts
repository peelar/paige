import { createHash } from "node:crypto";

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.ts";
import {
  policyBoundWatches,
  watchDispatchReservations,
  watchEffectiveRevisions,
  watchObservationClaims,
  watchProcessingBudgetBuckets,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  effectiveWatchRevisionSchema,
  watchCapabilityFamilySchema,
  type EffectiveWatchRevision,
} from "./watch-contract.ts";
import { watchProviderAuthorizationSchema } from "./watch-event-admission.ts";
import {
  watchObservationHandoffSchema,
  type WatchObservationHandoff,
} from "./watch-observation-windows.ts";
import {
  previewWatchPolicy,
  WatchPolicyValidationError,
} from "./watch-policy-preview.ts";
import {
  availableWatchCapabilities,
  requireWatchServiceReady,
  watchServiceContextSchema,
} from "./watch-service-readiness.ts";

type DispatchDatabase = Pick<DocsAgentDatabase, "insert" | "select" | "update">;

export const watchDispatchReadinessContextSchema = watchServiceContextSchema
  .extend({ providerAuthorization: watchProviderAuthorizationSchema })
  .strict();

export const watchDispatchReservationSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  replayed: z.boolean(),
  hourBucket: z.string().datetime({ offset: true }),
  reservedAt: z.string().datetime({ offset: true }),
}).strict();

export const watchDispatchReadyHandoffSchema = z.object({
  reservation: watchDispatchReservationSchema,
  effectiveRevision: effectiveWatchRevisionSchema,
  handoff: watchObservationHandoffSchema,
  preparedAt: z.string().datetime({ offset: true }),
}).strict();

export type WatchDispatchReadyHandoff = z.infer<
  typeof watchDispatchReadyHandoffSchema
>;
export type WatchDispatchReadinessContext = z.infer<
  typeof watchDispatchReadinessContextSchema
>;

export const watchDispatchCapabilityAuthoritySchema = z.object({
  reservationId: z.string().regex(/^[a-f0-9]{64}$/u),
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  capabilityGrants: z.array(watchCapabilityFamilySchema).max(6),
}).strict();

export type WatchDispatchCapabilityAuthority = z.infer<
  typeof watchDispatchCapabilityAuthoritySchema
>;

export class WatchDispatchReadinessError extends Error {
  readonly code:
    | "authority-unavailable"
    | "budget-exhausted"
    | "handoff-invalid"
    | "provider-authorization-unavailable"
    | "retention-expired"
    | "storage-unavailable";

  constructor(
    code: WatchDispatchReadinessError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WatchDispatchReadinessError";
    this.code = code;
  }
}

export async function prepareWatchDispatch(
  handoffInput: WatchObservationHandoff,
  context: unknown,
): Promise<WatchDispatchReadyHandoff> {
  const handoffResult = watchObservationHandoffSchema.safeParse(handoffInput);
  if (!handoffResult.success) {
    throw new WatchDispatchReadinessError(
      "handoff-invalid",
      "Watch dispatch requires a valid provider-neutral observation handoff.",
    );
  }
  const handoff = handoffResult.data;
  const authorization = watchProviderAuthorizationSchema.safeParse(
    typeof context === "object" && context !== null &&
        "providerAuthorization" in context
      ? context.providerAuthorization
      : undefined,
  );
  const providerWorkspaceIds = new Set(
    handoff.observations.map(({ provenance }) => provenance.providerWorkspaceId),
  );
  if (
    !authorization.success ||
    authorization.data.provider !== handoff.source.provider ||
    providerWorkspaceIds.size !== 1 ||
    !providerWorkspaceIds.has(authorization.data.providerWorkspaceId)
  ) {
    throw new WatchDispatchReadinessError(
      "provider-authorization-unavailable",
      "Watch dispatch requires current verified authorization for the handoff provider workspace.",
    );
  }

  const readyContext = await requireWatchServiceReady(context);
  const now = readyContext.now ?? new Date();
  const preparedAt = now.toISOString();
  const hourBucket = utcHourBucket(now);
  const reservationId = deterministicReservationId(handoff);

  try {
    return await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
      const effectiveRevision = await readCurrentAuthority(
        tx,
        handoff,
        readyContext,
        now,
      );
      validateHandoffAgainstAuthority(handoff, effectiveRevision, now);
      await validateClaimReferences(tx, handoff);

      const existing = await tx.select().from(watchDispatchReservations).where(eq(
        watchDispatchReservations.id,
        reservationId,
      )).limit(1);
      if (existing[0] !== undefined) {
        if (existing[0].status !== "ready") {
          throw new WatchDispatchReadinessError(
            "storage-unavailable",
            "The existing watch dispatch reservation is incomplete.",
          );
        }
        return readyResult(
          handoff,
          effectiveRevision,
          existing[0].id,
          true,
          existing[0].hourBucket,
          existing[0].reservedAt,
          preparedAt,
        );
      }

      const claimIds = [...handoff.claimIds].sort();
      const characterCount = handoff.observations.reduce(
        (sum, observation) => sum + observation.content.characterCount,
        0,
      );
      const inserted = await tx.insert(watchDispatchReservations).values({
        id: reservationId,
        workspaceId: handoff.workspaceId,
        watchId: handoff.watchId,
        effectiveRevisionId: handoff.effectiveRevisionId,
        provider: handoff.source.provider,
        resourceType: handoff.source.resource.type,
        resourceId: handoff.source.resource.id,
        handoffKind: handoff.kind,
        claimIds,
        observationCount: handoff.observations.length,
        characterCount,
        hourBucket,
        status: "reserving",
        reservedAt: preparedAt,
        updatedAt: preparedAt,
      }).onConflictDoNothing().returning({ id: watchDispatchReservations.id });
      if (inserted.length !== 1) {
        throw new WatchDispatchReadinessError(
          "storage-unavailable",
          "The watch dispatch reservation changed concurrently. Retry the same handoff.",
        );
      }

      const budgetLimit = effectiveRevision.policy.budgets.processingRunsPerHour;
      const bucketId = deterministicBudgetBucketId(
        handoff.workspaceId,
        handoff.effectiveRevisionId,
        hourBucket,
      );
      await tx.insert(watchProcessingBudgetBuckets).values({
        id: bucketId,
        workspaceId: handoff.workspaceId,
        watchId: handoff.watchId,
        effectiveRevisionId: handoff.effectiveRevisionId,
        hourBucket,
        reservedRuns: 0,
        limitSnapshot: budgetLimit,
        updatedAt: preparedAt,
      }).onConflictDoNothing();
      const reserved = await tx.update(watchProcessingBudgetBuckets).set({
        reservedRuns: sql`${watchProcessingBudgetBuckets.reservedRuns} + 1`,
        updatedAt: preparedAt,
      }).where(and(
        eq(watchProcessingBudgetBuckets.id, bucketId),
        eq(watchProcessingBudgetBuckets.limitSnapshot, budgetLimit),
        lt(watchProcessingBudgetBuckets.reservedRuns, budgetLimit),
      )).returning({ reservedRuns: watchProcessingBudgetBuckets.reservedRuns });
      if (reserved.length !== 1) {
        throw new WatchDispatchReadinessError(
          "budget-exhausted",
          "The effective watch revision has no processing runs remaining in the current UTC hour.",
        );
      }

      await tx.update(watchDispatchReservations).set({
        status: "ready",
        updatedAt: preparedAt,
      }).where(eq(watchDispatchReservations.id, reservationId));
      return readyResult(
        handoff,
        effectiveRevision,
        reservationId,
        false,
        hourBucket,
        preparedAt,
        preparedAt,
      );
    }));
  } catch (error) {
    if (error instanceof WatchDispatchReadinessError) throw error;
    throw new WatchDispatchReadinessError(
      "storage-unavailable",
      "Watch dispatch readiness could not read or reserve required durable state.",
      { cause: error },
    );
  }
}

/**
 * Resolve an opaque, server-issued dispatch reservation back to its current
 * effective watch authority. Callers do not supply watch, revision, provider,
 * workspace, or capability values.
 */
export async function resolveWatchDispatchCapabilityAuthority(
  reservationIdInput: string,
  context: unknown,
): Promise<WatchDispatchCapabilityAuthority> {
  const reservationId = z.string().regex(/^[a-f0-9]{64}$/u).parse(reservationIdInput);
  const readyContext = await requireWatchServiceReady(context);
  const now = readyContext.now ?? new Date();

  try {
    return await withDocsAgentDatabase(async (db) => {
      const rows = await db.select({
        reservationWorkspaceId: watchDispatchReservations.workspaceId,
        reservationStatus: watchDispatchReservations.status,
        reservationWatchId: watchDispatchReservations.watchId,
        reservationEffectiveRevisionId: watchDispatchReservations.effectiveRevisionId,
        reservationProvider: watchDispatchReservations.provider,
        reservationResourceType: watchDispatchReservations.resourceType,
        reservationResourceId: watchDispatchReservations.resourceId,
        lifecycleState: policyBoundWatches.lifecycleState,
        currentEffectiveRevisionId: policyBoundWatches.effectiveRevisionId,
        effectiveRevisionId: watchEffectiveRevisions.id,
        effectiveWatchId: watchEffectiveRevisions.watchId,
        proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
        contractVersion: watchEffectiveRevisions.contractVersion,
        policy: watchEffectiveRevisions.policy,
        approvedById: watchEffectiveRevisions.approvedById,
        approvedByLogin: watchEffectiveRevisions.approvedByLogin,
        approvedAt: watchEffectiveRevisions.approvedAt,
      }).from(watchDispatchReservations).innerJoin(
        policyBoundWatches,
        and(
          eq(policyBoundWatches.workspaceId, watchDispatchReservations.workspaceId),
          eq(policyBoundWatches.id, watchDispatchReservations.watchId),
        ),
      ).leftJoin(
        watchEffectiveRevisions,
        and(
          eq(watchEffectiveRevisions.workspaceId, watchDispatchReservations.workspaceId),
          eq(watchEffectiveRevisions.watchId, watchDispatchReservations.watchId),
          eq(watchEffectiveRevisions.id, watchDispatchReservations.effectiveRevisionId),
        ),
      ).where(and(
        eq(watchDispatchReservations.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(watchDispatchReservations.id, reservationId),
      )).limit(1);
      const row = rows[0];
      if (
        row === undefined ||
        row.reservationWorkspaceId !== DEFAULT_WORKSPACE_ID ||
        row.reservationStatus !== "ready" ||
        row.lifecycleState !== "active" ||
        row.currentEffectiveRevisionId !== row.reservationEffectiveRevisionId ||
        row.effectiveRevisionId !== row.reservationEffectiveRevisionId ||
        row.effectiveWatchId !== row.reservationWatchId ||
        row.proposalRevisionId === null ||
        row.contractVersion === null ||
        row.policy === null ||
        row.approvedById === null ||
        row.approvedByLogin === null ||
        row.approvedAt === null
      ) {
        throw new WatchDispatchReadinessError(
          "authority-unavailable",
          "The watch dispatch reservation has no current effective authority.",
        );
      }

      const revision = effectiveWatchRevisionSchema.safeParse({
        id: row.effectiveRevisionId,
        watchId: row.effectiveWatchId,
        proposalRevisionId: row.proposalRevisionId,
        contractVersion: row.contractVersion,
        policy: row.policy,
        approvedBy: { id: row.approvedById, githubLogin: row.approvedByLogin },
        approvedAt: row.approvedAt,
      });
      if (!revision.success) {
        throw new WatchDispatchReadinessError(
          "authority-unavailable",
          "The watch dispatch reservation references invalid effective authority.",
        );
      }
      const policy = revision.data.policy;
      if (
        policy.source.provider !== row.reservationProvider ||
        policy.source.resource.type !== row.reservationResourceType ||
        policy.source.resource.id !== row.reservationResourceId ||
        policy.expiresAt === null ||
        now.getTime() >= new Date(policy.expiresAt).getTime()
      ) {
        throw new WatchDispatchReadinessError(
          "authority-unavailable",
          "The watch dispatch reservation is outside its current source or expiry authority.",
        );
      }
      try {
        previewWatchPolicy({
          contractVersion: revision.data.contractVersion,
          lifecycleState: "proposed",
          policy,
        }, {
          availableCapabilities: availableWatchCapabilities(readyContext),
          now,
        });
      } catch (error) {
        if (error instanceof WatchPolicyValidationError) {
          throw new WatchDispatchReadinessError(
            "authority-unavailable",
            "The watch dispatch reservation's effective policy is no longer usable.",
          );
        }
        throw error;
      }

      return watchDispatchCapabilityAuthoritySchema.parse({
        reservationId,
        watchId: revision.data.watchId,
        effectiveRevisionId: revision.data.id,
        capabilityGrants: policy.capabilityGrants,
      });
    });
  } catch (error) {
    if (error instanceof WatchDispatchReadinessError) throw error;
    throw new WatchDispatchReadinessError(
      "storage-unavailable",
      "Watch capability authority could not be resolved from durable dispatch state.",
      { cause: error },
    );
  }
}

async function readCurrentAuthority(
  tx: DispatchDatabase,
  handoff: WatchObservationHandoff,
  context: Awaited<ReturnType<typeof requireWatchServiceReady>>,
  now: Date,
): Promise<EffectiveWatchRevision> {
  const rows = await tx.select({
    watchId: policyBoundWatches.id,
    workspaceId: policyBoundWatches.workspaceId,
    lifecycleState: policyBoundWatches.lifecycleState,
    effectivePointer: policyBoundWatches.effectiveRevisionId,
    effectiveRevisionId: watchEffectiveRevisions.id,
    effectiveWatchId: watchEffectiveRevisions.watchId,
    proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
    contractVersion: watchEffectiveRevisions.contractVersion,
    policy: watchEffectiveRevisions.policy,
    approvedById: watchEffectiveRevisions.approvedById,
    approvedByLogin: watchEffectiveRevisions.approvedByLogin,
    approvedAt: watchEffectiveRevisions.approvedAt,
  }).from(policyBoundWatches).leftJoin(
    watchEffectiveRevisions,
    and(
      eq(watchEffectiveRevisions.id, handoff.effectiveRevisionId),
      eq(watchEffectiveRevisions.watchId, policyBoundWatches.id),
      eq(watchEffectiveRevisions.workspaceId, policyBoundWatches.workspaceId),
    ),
  ).where(and(
    eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(policyBoundWatches.id, handoff.watchId),
  )).limit(1);
  const row = rows[0];
  if (
    handoff.workspaceId !== DEFAULT_WORKSPACE_ID ||
    row === undefined ||
    row.workspaceId !== handoff.workspaceId ||
    row.lifecycleState !== "active" ||
    row.effectivePointer !== handoff.effectiveRevisionId ||
    row.effectiveRevisionId !== handoff.effectiveRevisionId ||
    row.effectiveWatchId !== handoff.watchId ||
    row.proposalRevisionId === null ||
    row.contractVersion === null ||
    row.policy === null ||
    row.approvedById === null ||
    row.approvedByLogin === null ||
    row.approvedAt === null
  ) {
    throw new WatchDispatchReadinessError(
      "authority-unavailable",
      "The handoff's exact effective watch revision is not currently dispatchable.",
    );
  }
  const revision = effectiveWatchRevisionSchema.safeParse({
    id: row.effectiveRevisionId,
    watchId: row.effectiveWatchId,
    proposalRevisionId: row.proposalRevisionId,
    contractVersion: row.contractVersion,
    policy: row.policy,
    approvedBy: { id: row.approvedById, githubLogin: row.approvedByLogin },
    approvedAt: row.approvedAt,
  });
  if (!revision.success) {
    throw new WatchDispatchReadinessError(
      "authority-unavailable",
      "The handoff's effective watch revision is invalid.",
    );
  }
  try {
    previewWatchPolicy({
      contractVersion: revision.data.contractVersion,
      lifecycleState: "proposed",
      policy: revision.data.policy,
    }, {
      availableCapabilities: availableWatchCapabilities(context),
      now,
    });
  } catch (error) {
    if (error instanceof WatchPolicyValidationError) {
      throw new WatchDispatchReadinessError(
        "authority-unavailable",
        "The handoff's effective watch authority is no longer usable.",
      );
    }
    throw error;
  }
  return revision.data;
}

function validateHandoffAgainstAuthority(
  handoff: WatchObservationHandoff,
  revision: EffectiveWatchRevision,
  now: Date,
): void {
  const policy = revision.policy;
  if (
    stable(handoff.source) !== stable(policy.source) ||
    handoff.observations.some((observation) =>
      observation.watchId !== handoff.watchId ||
      observation.effectiveRevisionId !== handoff.effectiveRevisionId ||
      stable(observation.source) !== stable(handoff.source) ||
      !policy.context.eventTypes.includes(observation.eventType) ||
      observation.content.retentionSeconds !== policy.retention.rawObservationSeconds
    )
  ) {
    throw new WatchDispatchReadinessError(
      "handoff-invalid",
      "The observation handoff is outside its effective watch source, event, or retention policy.",
    );
  }
  const expiresAt = policy.expiresAt;
  if (expiresAt === null || now.getTime() >= new Date(expiresAt).getTime()) {
    throw new WatchDispatchReadinessError(
      "authority-unavailable",
      "The effective watch revision expired before dispatch readiness.",
    );
  }
  const characterCount = handoff.observations.reduce(
    (sum, observation) => sum + observation.content.characterCount,
    0,
  );
  if (characterCount > policy.context.maxCharacters) {
    throw new WatchDispatchReadinessError(
      "handoff-invalid",
      "The observation handoff exceeds its effective context limit.",
    );
  }
  if (policy.evaluation.mode === "per_event") {
    if (handoff.kind !== "per_event" || handoff.observations.length !== 1) {
      throw new WatchDispatchReadinessError(
        "handoff-invalid",
        "Per-event authority requires exactly one per-event observation handoff.",
      );
    }
    return;
  }
  const durationMs = new Date(handoff.closedAt).getTime() -
    new Date(handoff.openedAt).getTime();
  if (
    handoff.kind !== "windowed" ||
    handoff.observations.length > policy.evaluation.maxObservations ||
    durationMs < 0 ||
    durationMs > policy.evaluation.windowSeconds * 1_000 ||
    durationMs > policy.retention.rawObservationSeconds * 1_000
  ) {
    throw new WatchDispatchReadinessError(
      "retention-expired",
      "The observation window exceeds its effective duration, count, or raw-retention bound.",
    );
  }
}

async function validateClaimReferences(
  tx: DispatchDatabase,
  handoff: WatchObservationHandoff,
): Promise<void> {
  if (new Set(handoff.claimIds).size !== handoff.claimIds.length) {
    throw new WatchDispatchReadinessError(
      "handoff-invalid",
      "The observation handoff contains duplicate occurrence claims.",
    );
  }
  const claims = await tx.select().from(watchObservationClaims).where(inArray(
    watchObservationClaims.id,
    handoff.claimIds,
  ));
  if (
    claims.length !== handoff.claimIds.length ||
    claims.some((claim) =>
      claim.workspaceId !== handoff.workspaceId ||
      claim.watchId !== handoff.watchId ||
      claim.effectiveRevisionId !== handoff.effectiveRevisionId ||
      claim.provider !== handoff.source.provider ||
      claim.resourceType !== handoff.source.resource.type ||
      claim.resourceId !== handoff.source.resource.id ||
      claim.status !== "claimed"
    ) ||
    !handoff.observations.every((observation) =>
      claims.some((claim) =>
        claim.providerEventId === observation.provenance.providerEventId
      )
    )
  ) {
    throw new WatchDispatchReadinessError(
      "handoff-invalid",
      "The observation handoff does not match its durable occurrence claims.",
    );
  }
}

function readyResult(
  handoff: WatchObservationHandoff,
  effectiveRevision: EffectiveWatchRevision,
  reservationId: string,
  replayed: boolean,
  hourBucket: string,
  reservedAt: string,
  preparedAt: string,
): WatchDispatchReadyHandoff {
  return watchDispatchReadyHandoffSchema.parse({
    reservation: {
      id: reservationId,
      replayed,
      hourBucket,
      reservedAt,
    },
    effectiveRevision,
    handoff,
    preparedAt,
  });
}

function deterministicReservationId(handoff: WatchObservationHandoff): string {
  return hash([
    "watch-dispatch",
    handoff.workspaceId,
    handoff.watchId,
    handoff.effectiveRevisionId,
    handoff.source.provider,
    handoff.source.resource.type,
    handoff.source.resource.id,
    handoff.kind,
    ...[...handoff.claimIds].sort(),
  ]);
}

function deterministicBudgetBucketId(
  workspaceId: string,
  effectiveRevisionId: string,
  hourBucket: string,
): string {
  return hash(["watch-processing-budget", workspaceId, effectiveRevisionId, hourBucket]);
}

function utcHourBucket(now: Date): string {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}
