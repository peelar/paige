import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  withDocsAgentDatabase,
  type DocsAgentDatabase,
} from "./db/client.ts";
import {
  policyBoundWatches,
  watchEffectiveRevisions,
  watchPolicyRevisions,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  activePolicyBoundWatchSchema,
  approveWatchProposalInputSchema,
  approveWatchProposalResultSchema,
  createProposedWatchInputSchema,
  getPolicyBoundWatchInputSchema,
  policyBoundWatchSchema,
  WATCH_POLICY_CONTRACT_VERSION,
  watchActorSchema,
  watchCapabilityFamilySchema,
  type ActivePolicyBoundWatch,
  type ApproveWatchProposalResult,
  type PolicyBoundWatch,
} from "./watch-contract.ts";
import {
  previewWatchPolicy,
  type WatchPolicyPreviewContext,
} from "./watch-policy-preview.ts";

export * from "./watch-contract.ts";

export async function createProposedWatch(
  input: z.input<typeof createProposedWatchInputSchema>,
): Promise<PolicyBoundWatch> {
  const parsed = createProposedWatchInputSchema.parse(input);
  const watchId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();

  await withDocsAgentDatabase(async (db) => {
    await db.transaction(async (tx) => {
      await tx.insert(policyBoundWatches).values({
        id: watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        lifecycleState: "proposed",
        effectiveRevisionId: null,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(watchPolicyRevisions).values({
        id: revisionId,
        watchId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        revision: 1,
        contractVersion: WATCH_POLICY_CONTRACT_VERSION,
        policy: parsed.policy,
        createdById: parsed.actor.id,
        createdByLogin: parsed.actor.githubLogin,
        createdAt: now,
      });
    });
  });

  return getPolicyBoundWatch({ id: watchId });
}

export type WatchApprovalContext = WatchPolicyPreviewContext & {
  operator: z.input<typeof watchActorSchema>;
};

export async function approveWatchProposal(
  input: z.input<typeof approveWatchProposalInputSchema>,
  context: WatchApprovalContext,
): Promise<ApproveWatchProposalResult> {
  const parsed = approveWatchProposalInputSchema.parse(input);
  const parsedContext = z.object({
    operator: watchActorSchema,
    availableCapabilities: z.array(watchCapabilityFamilySchema),
    now: z.date().optional(),
  }).strict().parse(context);
  const approvedAt = (parsedContext.now ?? new Date()).toISOString();
  const effectiveRevisionId = randomUUID();

  const activation = await withDocsAgentDatabase(async (db) =>
    db.transaction(async (tx) => {
      const watchRows = await tx
        .select({
          id: policyBoundWatches.id,
          lifecycleState: policyBoundWatches.lifecycleState,
          effectiveRevisionId: policyBoundWatches.effectiveRevisionId,
          proposalRevisionId: watchPolicyRevisions.id,
          proposalRevision: watchPolicyRevisions.revision,
          contractVersion: watchPolicyRevisions.contractVersion,
          proposalPolicy: watchPolicyRevisions.policy,
        })
        .from(policyBoundWatches)
        .innerJoin(
          watchPolicyRevisions,
          and(
            eq(watchPolicyRevisions.watchId, policyBoundWatches.id),
            eq(watchPolicyRevisions.workspaceId, policyBoundWatches.workspaceId),
          ),
        )
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        ))
        .orderBy(desc(watchPolicyRevisions.revision))
        .limit(1);
      const watch = watchRows[0];
      if (watch === undefined) {
        throw new Error(`Policy-bound watch ${parsed.watchId} was not found.`);
      }

      if (watch.lifecycleState === "active" && watch.effectiveRevisionId !== null) {
        const existing = await readEffectiveRevisionById(tx, watch.effectiveRevisionId);
        if (existing?.proposalRevisionId === parsed.proposalRevisionId) {
          return { created: false, replayed: true };
        }
        throw new Error(
          `Watch ${parsed.watchId} is already active on a different effective revision.`,
        );
      }
      if (watch.lifecycleState !== "proposed") {
        throw new Error(`Watch ${parsed.watchId} is not awaiting proposal approval.`);
      }
      if (
        watch.proposalRevisionId !== parsed.proposalRevisionId ||
        watch.proposalRevision !== parsed.expectedProposalRevision
      ) {
        throw new Error(
          `Watch ${parsed.watchId} proposal changed concurrently. Inspect the latest proposal before approving it.`,
        );
      }

      const preview = previewWatchPolicy({
        contractVersion: watch.contractVersion,
        lifecycleState: "proposed",
        policy: watch.proposalPolicy,
      }, {
        availableCapabilities: parsedContext.availableCapabilities,
        now: parsedContext.now,
      });

      const inserted = await tx
        .insert(watchEffectiveRevisions)
        .values({
          id: effectiveRevisionId,
          watchId: parsed.watchId,
          workspaceId: DEFAULT_WORKSPACE_ID,
          proposalRevisionId: parsed.proposalRevisionId,
          contractVersion: WATCH_POLICY_CONTRACT_VERSION,
          policy: preview.effectivePolicy,
          approvalKey: parsed.idempotencyKey,
          approvedById: parsedContext.operator.id,
          approvedByLogin: parsedContext.operator.githubLogin,
          approvedAt,
        })
        .onConflictDoNothing()
        .returning({ id: watchEffectiveRevisions.id });

      if (inserted.length === 0) {
        const existing = await readEffectiveRevisionByProposal(
          tx,
          parsed.watchId,
          parsed.proposalRevisionId,
        );
        if (existing === undefined) {
          throw new Error(
            `Approval key ${parsed.idempotencyKey} is already assigned to another watch revision.`,
          );
        }
        await activateExistingRevision(tx, parsed.watchId, existing.id, approvedAt);
        return { created: false, replayed: true };
      }

      const updated = await tx
        .update(policyBoundWatches)
        .set({
          lifecycleState: "active",
          effectiveRevisionId,
          updatedAt: approvedAt,
        })
        .where(and(
          eq(policyBoundWatches.id, parsed.watchId),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(policyBoundWatches.lifecycleState, "proposed"),
          isNull(policyBoundWatches.effectiveRevisionId),
        ))
        .returning({ id: policyBoundWatches.id });
      if (updated.length === 0) {
        throw new Error(
          `Watch ${parsed.watchId} changed concurrently during approval.`,
        );
      }

      return { created: true, replayed: false };
    })
  );

  return approveWatchProposalResultSchema.parse({
    ...activation,
    watch: await getActivePolicyBoundWatch({ id: parsed.watchId }),
  });
}

export async function getActivePolicyBoundWatch(
  input: z.input<typeof getPolicyBoundWatchInputSchema>,
): Promise<ActivePolicyBoundWatch> {
  const parsed = getPolicyBoundWatchInputSchema.parse(input);

  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select({
        id: policyBoundWatches.id,
        workspaceId: policyBoundWatches.workspaceId,
        lifecycleState: policyBoundWatches.lifecycleState,
        createdAt: policyBoundWatches.createdAt,
        updatedAt: policyBoundWatches.updatedAt,
        effectiveRevisionId: watchEffectiveRevisions.id,
        proposalRevisionId: watchEffectiveRevisions.proposalRevisionId,
        contractVersion: watchEffectiveRevisions.contractVersion,
        policy: watchEffectiveRevisions.policy,
        approvedById: watchEffectiveRevisions.approvedById,
        approvedByLogin: watchEffectiveRevisions.approvedByLogin,
        approvedAt: watchEffectiveRevisions.approvedAt,
      })
      .from(policyBoundWatches)
      .innerJoin(
        watchEffectiveRevisions,
        and(
          eq(watchEffectiveRevisions.id, policyBoundWatches.effectiveRevisionId),
          eq(watchEffectiveRevisions.watchId, policyBoundWatches.id),
          eq(watchEffectiveRevisions.workspaceId, policyBoundWatches.workspaceId),
        ),
      )
      .where(and(
        eq(policyBoundWatches.id, parsed.id),
        eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(policyBoundWatches.lifecycleState, "active"),
      ))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Policy-bound watch ${parsed.id} is not active.`);
    }

    return activePolicyBoundWatchSchema.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      lifecycleState: row.lifecycleState,
      effectiveRevision: {
        id: row.effectiveRevisionId,
        watchId: row.id,
        proposalRevisionId: row.proposalRevisionId,
        contractVersion: row.contractVersion,
        policy: row.policy,
        approvedBy: {
          id: row.approvedById,
          githubLogin: row.approvedByLogin,
        },
        approvedAt: row.approvedAt,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
}

export async function getPolicyBoundWatch(
  input: z.input<typeof getPolicyBoundWatchInputSchema>,
): Promise<PolicyBoundWatch> {
  const parsed = getPolicyBoundWatchInputSchema.parse(input);

  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select({
        id: policyBoundWatches.id,
        workspaceId: policyBoundWatches.workspaceId,
        lifecycleState: policyBoundWatches.lifecycleState,
        createdAt: policyBoundWatches.createdAt,
        updatedAt: policyBoundWatches.updatedAt,
        revisionId: watchPolicyRevisions.id,
        revision: watchPolicyRevisions.revision,
        contractVersion: watchPolicyRevisions.contractVersion,
        policy: watchPolicyRevisions.policy,
        createdById: watchPolicyRevisions.createdById,
        createdByLogin: watchPolicyRevisions.createdByLogin,
        revisionCreatedAt: watchPolicyRevisions.createdAt,
      })
      .from(policyBoundWatches)
      .innerJoin(
        watchPolicyRevisions,
        and(
          eq(watchPolicyRevisions.watchId, policyBoundWatches.id),
          eq(watchPolicyRevisions.workspaceId, policyBoundWatches.workspaceId),
        ),
      )
      .where(
        and(
          eq(policyBoundWatches.id, parsed.id),
          eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
        ),
      )
      .orderBy(desc(watchPolicyRevisions.revision))
      .limit(1);
    const row = rows[0];

    if (row === undefined) {
      throw new Error(`Policy-bound watch ${parsed.id} was not found.`);
    }

    return policyBoundWatchSchema.parse({
      id: row.id,
      workspaceId: row.workspaceId,
      lifecycleState: row.lifecycleState,
      latestProposal: {
        id: row.revisionId,
        watchId: row.id,
        revision: row.revision,
        contractVersion: row.contractVersion,
        policy: row.policy,
        createdBy: {
          id: row.createdById,
          githubLogin: row.createdByLogin,
        },
        createdAt: row.revisionCreatedAt,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
}

type WatchExecutor = Pick<DocsAgentDatabase, "select" | "update">;

async function readEffectiveRevisionById(
  db: WatchExecutor,
  id: string,
) {
  const rows = await db
    .select()
    .from(watchEffectiveRevisions)
    .where(and(
      eq(watchEffectiveRevisions.id, id),
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
    ))
    .limit(1);
  return rows[0];
}

async function readEffectiveRevisionByProposal(
  db: WatchExecutor,
  watchId: string,
  proposalRevisionId: string,
) {
  const rows = await db
    .select()
    .from(watchEffectiveRevisions)
    .where(and(
      eq(watchEffectiveRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(watchEffectiveRevisions.watchId, watchId),
      eq(watchEffectiveRevisions.proposalRevisionId, proposalRevisionId),
    ))
    .limit(1);
  return rows[0];
}

async function activateExistingRevision(
  db: WatchExecutor,
  watchId: string,
  effectiveRevisionId: string,
  updatedAt: string,
): Promise<void> {
  await db
    .update(policyBoundWatches)
    .set({ lifecycleState: "active", effectiveRevisionId, updatedAt })
    .where(and(
      eq(policyBoundWatches.id, watchId),
      eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(policyBoundWatches.lifecycleState, "proposed"),
      isNull(policyBoundWatches.effectiveRevisionId),
    ));
}
