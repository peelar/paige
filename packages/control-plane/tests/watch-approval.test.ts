import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";

import {
  approveWatchProposal,
  createProposedWatch,
  getActivePolicyBoundWatch,
  getPolicyBoundWatch,
  type WatchApprovalContext,
} from "../src/policy-bound-watches.ts";
import { approveWatchProposalInputSchema } from "../src/watch-contract.ts";
import type { ProposedWatchPolicy } from "../src/watch-contract.ts";
import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import { watchPolicyRevisions } from "../src/db/schema.ts";
import { WatchPolicyValidationError } from "../src/watch-policy-preview.ts";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const APPROVAL_CONTEXT: WatchApprovalContext = {
  operator: { id: "operator-66", githubLogin: "docs-owner" },
  availableCapabilities: [
    "knowledge.read",
    "repository.read",
    "docs_work.manage",
    "draft.edit",
    "follow_up.schedule",
    "provider.deliver",
  ],
  now: NOW,
};

test("watch approval freezes one immutable effective revision", async () => {
  await withTemporaryDatabase(async () => {
    const proposed = await createProposedWatch({
      policy: validPolicy(),
      actor: { id: "author-66", githubLogin: "watch-author" },
    });
    await assert.rejects(
      () => getActivePolicyBoundWatch({ id: proposed.id }),
      /is not active/,
    );

    const approvalInput = {
      watchId: proposed.id,
      proposalRevisionId: proposed.latestProposal.id,
      expectedProposalRevision: 1,
      decision: "approved" as const,
      idempotencyKey: "approve-watch-66",
    };
    const approved = await approveWatchProposal(approvalInput, APPROVAL_CONTEXT);

    assert.equal(approved.created, true);
    assert.equal(approved.replayed, false);
    assert.equal(approved.watch.lifecycleState, "active");
    assert.equal(
      approved.watch.effectiveRevision.proposalRevisionId,
      proposed.latestProposal.id,
    );
    assert.deepEqual(approved.watch.effectiveRevision.policy, validPolicy());
    assert.deepEqual(approved.watch.effectiveRevision.approvedBy, {
      id: "operator-66",
      githubLogin: "docs-owner",
    });

    const activeRead = await getActivePolicyBoundWatch({ id: proposed.id });
    assert.equal(
      activeRead.effectiveRevision.id,
      approved.watch.effectiveRevision.id,
      "downstream reads stay bound to the approved effective revision id",
    );

    const duplicate = await approveWatchProposal(
      { ...approvalInput, idempotencyKey: "approve-watch-66-retry" },
      APPROVAL_CONTEXT,
    );
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.replayed, true);
    assert.equal(
      duplicate.watch.effectiveRevision.id,
      approved.watch.effectiveRevision.id,
    );
    assert.equal(await effectiveRevisionCount(), 1);

    const changedProposal = {
      ...validPolicy(),
      goal: "A later, broader proposal that was never approved.",
      capabilityGrants: ["knowledge.read", "repository.read"],
    };
    await withDocsAgentDatabase(async (db) => {
      await db
        .update(watchPolicyRevisions)
        .set({ policy: changedProposal })
        .where(eq(watchPolicyRevisions.id, proposed.latestProposal.id));
    });
    const afterProposalMutation = await getActivePolicyBoundWatch({ id: proposed.id });
    assert.deepEqual(
      afterProposalMutation.effectiveRevision.policy,
      validPolicy(),
      "an approved revision is a frozen policy copy",
    );
  });
});

test("watch approval fails closed for missing, stale, invalid, or unavailable state", async () => {
  expect.hasAssertions();
  await withTemporaryDatabase(async (tempRoot) => {
    const proposed = await createProposedWatch({
      policy: validPolicy(),
      actor: { id: "author-66", githubLogin: "watch-author" },
    });
    const baseInput = {
      watchId: proposed.id,
      proposalRevisionId: proposed.latestProposal.id,
      expectedProposalRevision: 1,
      decision: "approved" as const,
      idempotencyKey: "approve-watch-66-failures",
    };

    expect(approveWatchProposalInputSchema.safeParse({
      ...baseInput,
      actor: { id: "forged", githubLogin: "forged" },
    }).success).toBe(false);
    expect(approveWatchProposalInputSchema.safeParse({
      ...baseInput,
      decision: "denied",
    }).success).toBe(false);

    await assert.rejects(
      () => approveWatchProposal({
        ...baseInput,
        expectedProposalRevision: 2,
      }, APPROVAL_CONTEXT),
      /proposal changed concurrently/,
    );
    assert.equal((await getPolicyBoundWatch({ id: proposed.id })).lifecycleState, "proposed");

    await assert.rejects(
      () => approveWatchProposal({
        watchId: proposed.id,
        proposalRevisionId: proposed.latestProposal.id,
        expectedProposalRevision: 1,
        idempotencyKey: "missing-explicit-decision",
      } as never, APPROVAL_CONTEXT),
      /invalid input/i,
    );
    assert.equal((await getPolicyBoundWatch({ id: proposed.id })).lifecycleState, "proposed");

    const invalid = await createProposedWatch({
      policy: {
        ...validPolicy(),
        delivery: { mode: "silent" },
        capabilityGrants: ["provider.deliver"],
      },
      actor: { id: "author-invalid", githubLogin: "watch-author" },
    });
    await assert.rejects(
      () => approveWatchProposal({
        watchId: invalid.id,
        proposalRevisionId: invalid.latestProposal.id,
        expectedProposalRevision: 1,
        decision: "approved",
        idempotencyKey: "invalid-policy-approval",
      }, APPROVAL_CONTEXT),
      WatchPolicyValidationError,
    );
    assert.equal((await getPolicyBoundWatch({ id: invalid.id })).lifecycleState, "proposed");

    const readyDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
    process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "unmigrated.sqlite")}`;
    await assert.rejects(
      () => approveWatchProposal(baseInput, APPROVAL_CONTEXT),
      /database schema is not ready/i,
    );
    process.env.DOCS_AGENT_DATABASE_URL = readyDatabaseUrl;
    assert.equal((await getPolicyBoundWatch({ id: proposed.id })).lifecycleState, "proposed");
  });
});

function validPolicy(): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
      resource: { type: "channel", id: "C-DOCS-FEEDBACK" },
    },
    goal: "Find evidence-backed documentation gaps discussed in this channel.",
    trigger: { type: "on_event" as const },
    evaluation: { mode: "per_event" as const },
    delivery: { mode: "silent" as const },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    },
    capabilityGrants: ["knowledge.read", "repository.read"],
    retention: { rawObservationSeconds: 0, auditDays: 30 },
    budgets: {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
  };
}

async function effectiveRevisionCount(): Promise<number> {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM watch_effective_revisions
    `);
    return Number(rows[0]?.count ?? 0);
  });
}

async function withTemporaryDatabase(
  run: (tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-approval-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "approval.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await migrateDocsAgentDatabase();
    await run(tempRoot);
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
