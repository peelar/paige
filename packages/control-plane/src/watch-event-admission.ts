import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import {
  policyBoundWatches,
  watchEffectiveRevisions,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  effectiveWatchRevisionSchema,
  watchSourceSchema,
} from "./watch-contract.ts";
import {
  previewWatchPolicy,
  WatchPolicyValidationError,
} from "./watch-policy-preview.ts";
import {
  availableWatchCapabilities,
  requireWatchServiceReady,
  watchServiceContextSchema,
} from "./watch-service-readiness.ts";

const identifierSchema = z.string().trim().min(1).max(500);

export const watchEventAdmissionLookupSchema = z.object({
  workspaceId: z.literal(DEFAULT_WORKSPACE_ID),
  providerWorkspaceId: identifierSchema,
  source: watchSourceSchema,
  eventType: identifierSchema,
}).strict();

export const watchProviderAuthorizationSchema = z.object({
  provider: z.string().trim().regex(/^[a-z][a-z0-9-]*$/).max(100),
  providerWorkspaceId: identifierSchema,
  verification: z.literal("verified-webhook"),
}).strict();

export const watchEventAdmissionContextSchema = watchServiceContextSchema
  .extend({
    providerAuthorization: watchProviderAuthorizationSchema,
  })
  .strict();

export const watchEventAdmissionSchema = z.object({
  workspaceId: z.literal(DEFAULT_WORKSPACE_ID),
  providerWorkspaceId: identifierSchema,
  watchId: z.string().uuid(),
  stateRevision: z.number().int().positive(),
  effectiveRevision: effectiveWatchRevisionSchema,
  source: watchSourceSchema,
  eventType: identifierSchema,
  admittedAt: z.string().datetime({ offset: true }),
}).strict();

export type WatchEventAdmissionLookup = z.infer<
  typeof watchEventAdmissionLookupSchema
>;
export type WatchEventAdmission = z.infer<typeof watchEventAdmissionSchema>;
export type WatchEventAdmissionContext = z.infer<
  typeof watchEventAdmissionContextSchema
>;

export class WatchEventAdmissionError extends Error {
  readonly code:
    | "provider-authorization-unavailable"
    | "storage-unavailable"
    | "watch-state-invalid";

  constructor(
    code: WatchEventAdmissionError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WatchEventAdmissionError";
    this.code = code;
  }
}

/**
 * Resolves approved watch authority from provider metadata only. Callers must
 * not add raw provider content to this lookup; normalization happens only after
 * at least one exact admission has been returned.
 */
export async function resolveActiveWatchEventAdmissions(
  input: z.input<typeof watchEventAdmissionLookupSchema>,
  context: unknown,
): Promise<WatchEventAdmission[]> {
  const parsed = watchEventAdmissionLookupSchema.parse(input);
  const authorization = watchProviderAuthorizationSchema.safeParse(
    typeof context === "object" && context !== null &&
        "providerAuthorization" in context
      ? context.providerAuthorization
      : undefined,
  );
  if (!authorization.success) {
    throw new WatchEventAdmissionError(
      "provider-authorization-unavailable",
      "Watch event admission requires verified provider authorization.",
    );
  }
  if (
    authorization.data.provider !== parsed.source.provider ||
    authorization.data.providerWorkspaceId !==
      parsed.providerWorkspaceId
  ) {
    throw new WatchEventAdmissionError(
      "provider-authorization-unavailable",
      "The verified provider authorization does not match the event scope.",
    );
  }

  const readyContext = await requireWatchServiceReady(context);
  const admittedAt = (readyContext.now ?? new Date()).toISOString();

  try {
    return await withDocsAgentDatabase(async (db) => {
      const rows = await db
        .select({
          watchId: policyBoundWatches.id,
          workspaceId: policyBoundWatches.workspaceId,
          stateRevision: policyBoundWatches.stateRevision,
          effectiveRevisionPointer: policyBoundWatches.effectiveRevisionId,
          effectiveRevisionId: watchEffectiveRevisions.id,
          effectiveWatchId: watchEffectiveRevisions.watchId,
          proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
          contractVersion: watchEffectiveRevisions.contractVersion,
          policy: watchEffectiveRevisions.policy,
          approvedById: watchEffectiveRevisions.approvedById,
          approvedByLogin: watchEffectiveRevisions.approvedByLogin,
          approvedAt: watchEffectiveRevisions.approvedAt,
        })
        .from(policyBoundWatches)
        .leftJoin(
          watchEffectiveRevisions,
          and(
            eq(watchEffectiveRevisions.id, policyBoundWatches.effectiveRevisionId),
            eq(watchEffectiveRevisions.watchId, policyBoundWatches.id),
            eq(
              watchEffectiveRevisions.workspaceId,
              policyBoundWatches.workspaceId,
            ),
          ),
        )
        .where(and(
          eq(policyBoundWatches.workspaceId, parsed.workspaceId),
          eq(policyBoundWatches.lifecycleState, "active"),
        ));

      return rows.flatMap((row) => {
        if (
          row.effectiveRevisionPointer === null ||
          row.effectiveRevisionId === null ||
          row.effectiveWatchId === null ||
          row.proposalRevisionId === null ||
          row.contractVersion === null ||
          row.policy === null ||
          row.approvedById === null ||
          row.approvedByLogin === null ||
          row.approvedAt === null ||
          row.effectiveRevisionPointer !== row.effectiveRevisionId ||
          row.watchId !== row.effectiveWatchId
        ) {
          throw invalidWatchState(
            `Active watch ${row.watchId} does not have its referenced effective revision.`,
          );
        }

        const effective = effectiveWatchRevisionSchema.safeParse({
          id: row.effectiveRevisionId,
          watchId: row.effectiveWatchId,
          proposalRevisionId: row.proposalRevisionId,
          contractVersion: row.contractVersion,
          policy: row.policy,
          approvedBy: {
            id: row.approvedById,
            githubLogin: row.approvedByLogin,
          },
          approvedAt: row.approvedAt,
        });
        if (!effective.success) {
          throw invalidWatchState(
            `Active watch ${row.watchId} has an invalid effective revision.`,
          );
        }

        const policy = effective.data.policy;
        const expiresAt = policy.expiresAt;
        if (
          expiresAt === null ||
          new Date(expiresAt).getTime() <= new Date(admittedAt).getTime()
        ) {
          return [];
        }

        try {
          previewWatchPolicy({
            contractVersion: effective.data.contractVersion,
            lifecycleState: "proposed",
            policy,
          }, {
            availableCapabilities: availableWatchCapabilities(readyContext),
            now: readyContext.now,
          });
        } catch (error) {
          if (error instanceof WatchPolicyValidationError) {
            throw invalidWatchState(
              `Active watch ${row.watchId} has unusable effective authority.`,
            );
          }
          throw error;
        }

        if (
          policy.trigger.type !== "on_event" ||
          stable(policy.source) !== stable(parsed.source) ||
          !policy.context.eventTypes.includes(parsed.eventType)
        ) {
          return [];
        }

        return [watchEventAdmissionSchema.parse({
          workspaceId: row.workspaceId,
          providerWorkspaceId: parsed.providerWorkspaceId,
          watchId: row.watchId,
          stateRevision: row.stateRevision,
          effectiveRevision: effective.data,
          source: parsed.source,
          eventType: parsed.eventType,
          admittedAt,
        })];
      });
    });
  } catch (error) {
    if (error instanceof WatchEventAdmissionError) throw error;
    throw new WatchEventAdmissionError(
      "storage-unavailable",
      "Watch event admission could not read required durable watch state.",
      { cause: error },
    );
  }
}

function invalidWatchState(message: string): WatchEventAdmissionError {
  return new WatchEventAdmissionError("watch-state-invalid", message);
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}
