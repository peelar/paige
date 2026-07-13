import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import {
  watchEffectiveRevisions,
  watchObservationClaims,
} from "./db/schema.ts";
import { watchSourceSchema } from "./watch-contract.ts";

export const WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS = 3;

const identifierSchema = z.string().trim().min(1).max(500);

export const watchObservationClaimStatusSchema = z.enum([
  "claimed",
  "completed",
  "failed",
]);

export const watchObservationClaimFailureCodeSchema = z.enum([
  "processing-failed",
]);

export const claimWatchObservationInputSchema = z.object({
  workspaceId: identifierSchema,
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  source: watchSourceSchema,
  providerEventId: identifierSchema,
}).strict();

export const watchObservationClaimSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  workspaceId: identifierSchema,
  watchId: z.string().uuid(),
  effectiveRevisionId: z.string().uuid(),
  provider: identifierSchema,
  resourceType: identifierSchema,
  resourceId: identifierSchema,
  providerEventId: identifierSchema,
  status: watchObservationClaimStatusSchema,
  attempt: z.number().int().min(1).max(WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS),
  failureCode: watchObservationClaimFailureCodeSchema.nullable(),
  claimedAt: z.string().datetime({ offset: true }),
  failedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export const watchObservationClaimResultSchema = z.object({
  acquired: z.boolean(),
  claim: watchObservationClaimSchema,
}).strict();

export const failWatchObservationClaimInputSchema = z.object({
  claimId: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedAttempt: z.number().int().min(1).max(WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS),
  failureCode: watchObservationClaimFailureCodeSchema,
}).strict();

export const retryWatchObservationClaimInputSchema = z.object({
  claimId: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedAttempt: z.number().int().min(1).max(WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS),
}).strict();

export const completeWatchObservationClaimInputSchema = z.object({
  claimId: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedAttempt: z.number().int().min(1).max(WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS),
}).strict();

export type WatchObservationClaim = z.infer<typeof watchObservationClaimSchema>;
export type WatchObservationClaimResult = z.infer<typeof watchObservationClaimResultSchema>;

export type WatchObservationClaimContext = {
  now?: Date;
};

export class WatchObservationClaimError extends Error {
  readonly code:
    | "authority-invalid"
    | "claim-conflict"
    | "claim-not-found"
    | "invalid-transition"
    | "retry-exhausted"
    | "storage-unavailable";

  constructor(
    code: WatchObservationClaimError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WatchObservationClaimError";
    this.code = code;
  }
}

export async function claimWatchObservation(
  input: z.input<typeof claimWatchObservationInputSchema>,
  context: WatchObservationClaimContext = {},
): Promise<WatchObservationClaimResult> {
  const parsed = claimWatchObservationInputSchema.parse(input);
  const claimedAt = (context.now ?? new Date()).toISOString();
  const identity = claimIdentity(parsed);
  const id = deterministicClaimId(identity);

  try {
    return await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
      const revisions = await tx.select({
        id: watchEffectiveRevisions.id,
      }).from(watchEffectiveRevisions).where(and(
        eq(watchEffectiveRevisions.id, parsed.effectiveRevisionId),
        eq(watchEffectiveRevisions.watchId, parsed.watchId),
        eq(watchEffectiveRevisions.workspaceId, parsed.workspaceId),
      )).limit(1);
      if (revisions.length !== 1) {
        throw new WatchObservationClaimError(
          "authority-invalid",
          "The observation claim does not reference an effective watch revision in this workspace.",
        );
      }

      const inserted = await tx.insert(watchObservationClaims).values({
        id,
        ...identity,
        status: "claimed",
        attempt: 1,
        failureCode: null,
        claimedAt,
        failedAt: null,
        completedAt: null,
        updatedAt: claimedAt,
      }).onConflictDoNothing().returning();
      if (inserted[0] !== undefined) {
        return watchObservationClaimResultSchema.parse({
          acquired: true,
          claim: inserted[0],
        });
      }

      const existingRows = await tx.select().from(watchObservationClaims).where(and(
        eq(watchObservationClaims.workspaceId, identity.workspaceId),
        eq(watchObservationClaims.effectiveRevisionId, identity.effectiveRevisionId),
        eq(watchObservationClaims.provider, identity.provider),
        eq(watchObservationClaims.resourceType, identity.resourceType),
        eq(watchObservationClaims.resourceId, identity.resourceId),
        eq(watchObservationClaims.providerEventId, identity.providerEventId),
      )).limit(1);
      const existing = existingRows[0];
      if (existing === undefined) {
        throw new WatchObservationClaimError(
          "claim-conflict",
          "The observation claim identity collided with unrelated durable state.",
        );
      }
      return watchObservationClaimResultSchema.parse({
        acquired: false,
        claim: existing,
      });
    }));
  } catch (error) {
    if (error instanceof WatchObservationClaimError) throw error;
    throw new WatchObservationClaimError(
      "storage-unavailable",
      "Observation idempotency state could not be claimed from durable storage.",
      { cause: error },
    );
  }
}

export async function failWatchObservationClaim(
  input: z.input<typeof failWatchObservationClaimInputSchema>,
  context: WatchObservationClaimContext = {},
): Promise<WatchObservationClaim> {
  const parsed = failWatchObservationClaimInputSchema.parse(input);
  const failedAt = (context.now ?? new Date()).toISOString();
  return updateClaim(
    parsed.claimId,
    parsed.expectedAttempt,
    "claimed",
    {
      status: "failed",
      failureCode: parsed.failureCode,
      failedAt,
      updatedAt: failedAt,
    },
    "Only the current claimed attempt can be marked failed.",
  );
}

export async function retryWatchObservationClaim(
  input: z.input<typeof retryWatchObservationClaimInputSchema>,
  context: WatchObservationClaimContext = {},
): Promise<WatchObservationClaimResult> {
  const parsed = retryWatchObservationClaimInputSchema.parse(input);
  if (parsed.expectedAttempt >= WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS) {
    throw new WatchObservationClaimError(
      "retry-exhausted",
      `Observation claims permit at most ${WATCH_OBSERVATION_CLAIM_MAX_ATTEMPTS} explicit attempts.`,
    );
  }
  const claimedAt = (context.now ?? new Date()).toISOString();
  const claim = await updateClaim(
    parsed.claimId,
    parsed.expectedAttempt,
    "failed",
    {
      status: "claimed",
      attempt: parsed.expectedAttempt + 1,
      failureCode: null,
      claimedAt,
      failedAt: null,
      completedAt: null,
      updatedAt: claimedAt,
    },
    "Only the current failed attempt can be retried.",
  );
  return watchObservationClaimResultSchema.parse({ acquired: true, claim });
}

export async function completeWatchObservationClaim(
  input: z.input<typeof completeWatchObservationClaimInputSchema>,
  context: WatchObservationClaimContext = {},
): Promise<WatchObservationClaim> {
  const parsed = completeWatchObservationClaimInputSchema.parse(input);
  const completedAt = (context.now ?? new Date()).toISOString();
  return updateClaim(
    parsed.claimId,
    parsed.expectedAttempt,
    "claimed",
    {
      status: "completed",
      completedAt,
      updatedAt: completedAt,
    },
    "Only the current claimed attempt can be completed.",
  );
}

type ClaimIdentity = {
  workspaceId: string;
  watchId: string;
  effectiveRevisionId: string;
  provider: string;
  resourceType: string;
  resourceId: string;
  providerEventId: string;
};

function claimIdentity(
  input: z.output<typeof claimWatchObservationInputSchema>,
): ClaimIdentity {
  return {
    workspaceId: input.workspaceId,
    watchId: input.watchId,
    effectiveRevisionId: input.effectiveRevisionId,
    provider: input.source.provider,
    resourceType: input.source.resource.type,
    resourceId: input.source.resource.id,
    providerEventId: input.providerEventId,
  };
}

function deterministicClaimId(identity: ClaimIdentity): string {
  return createHash("sha256").update(JSON.stringify([
    identity.workspaceId,
    identity.watchId,
    identity.effectiveRevisionId,
    identity.provider,
    identity.resourceType,
    identity.resourceId,
    identity.providerEventId,
  ])).digest("hex");
}

async function updateClaim(
  claimId: string,
  expectedAttempt: number,
  expectedStatus: "claimed" | "failed",
  values: Partial<typeof watchObservationClaims.$inferInsert>,
  transitionMessage: string,
): Promise<WatchObservationClaim> {
  try {
    return await withDocsAgentDatabase(async (db) => {
      const updated = await db.update(watchObservationClaims).set(values).where(and(
        eq(watchObservationClaims.id, claimId),
        eq(watchObservationClaims.attempt, expectedAttempt),
        eq(watchObservationClaims.status, expectedStatus),
      )).returning();
      if (updated[0] !== undefined) return watchObservationClaimSchema.parse(updated[0]);

      const existing = await db.select({
        id: watchObservationClaims.id,
      }).from(watchObservationClaims).where(eq(
        watchObservationClaims.id,
        claimId,
      )).limit(1);
      if (existing.length === 0) {
        throw new WatchObservationClaimError(
          "claim-not-found",
          "The observation claim does not exist.",
        );
      }
      throw new WatchObservationClaimError("invalid-transition", transitionMessage);
    });
  } catch (error) {
    if (error instanceof WatchObservationClaimError) throw error;
    throw new WatchObservationClaimError(
      "storage-unavailable",
      "Observation idempotency state could not be updated in durable storage.",
      { cause: error },
    );
  }
}
