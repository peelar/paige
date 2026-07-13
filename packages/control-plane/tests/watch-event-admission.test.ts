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
  policyBoundWatches,
  workspaceSetup,
} from "../src/db/schema.ts";
import {
  approveWatchProposal,
  createProposedWatch,
} from "../src/policy-bound-watches.ts";
import { DEFAULT_WORKSPACE_ID } from "../src/setup-state.ts";
import {
  mutateWatchLifecycle,
  type WatchLifecycleContext,
} from "../src/watch-lifecycle.ts";
import type { ProposedWatchPolicy } from "../src/watch-contract.ts";
import {
  resolveActiveWatchEventAdmissions,
  watchEventAdmissionLookupSchema,
  WatchEventAdmissionError,
  type WatchEventAdmissionContext,
} from "../src/watch-event-admission.ts";
import {
  prepareWatchWorkspace,
  READY_WATCH_CAPABILITY_REGISTRY,
} from "./watch-test-fixtures.ts";

const NOW = new Date("2026-07-13T20:00:00.000Z");
const PROVIDER_WORKSPACE_ID = "T-DOCS";
const OPERATOR = { id: "operator-71", githubLogin: "docs-owner" };
const ADMISSION_CONTEXT: WatchEventAdmissionContext = {
  capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
  providerAuthorization: {
    provider: "slack",
    providerWorkspaceId: PROVIDER_WORKSPACE_ID,
    verification: "verified-webhook",
  },
  now: NOW,
};

test("resolves only exact active event watches and binds immutable authority", async () => {
  await withTemporaryDatabase(async () => {
    await prepareWatchWorkspace();
    const matching = await createActiveWatch("C-DOCS-FEEDBACK");
    await createActiveWatch("C-OTHER");

    const admissions = await resolveActiveWatchEventAdmissions(
      lookup("C-DOCS-FEEDBACK"),
      ADMISSION_CONTEXT,
    );
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0]?.watchId, matching.id);
    assert.equal(
      admissions[0]?.effectiveRevision.id,
      matching.effectiveRevision.id,
    );
    assert.equal(admissions[0]?.stateRevision, matching.stateRevision);
    assert.equal(admissions[0]?.providerWorkspaceId, PROVIDER_WORKSPACE_ID);
    assert.deepEqual(admissions[0]?.source, {
      provider: "slack",
      resource: { type: "channel", id: "C-DOCS-FEEDBACK" },
    });
    assert.equal(admissions[0]?.eventType, "message");
    assert.equal(admissions[0]?.admittedAt, NOW.toISOString());

    assert.deepEqual(
      await resolveActiveWatchEventAdmissions(lookup("C-UNWATCHED"), ADMISSION_CONTEXT),
      [],
    );
    assert.deepEqual(
      await resolveActiveWatchEventAdmissions({
        ...lookup("C-DOCS-FEEDBACK"),
        eventType: "reaction_added",
      }, ADMISSION_CONTEXT),
      [],
    );
    assert.equal(watchEventAdmissionLookupSchema.safeParse({
      ...lookup("C-DOCS-FEEDBACK"),
      text: "raw content must not enter lookup",
    }).success, false);
  });
});

test("paused and expired watches cannot admit provider events", async () => {
  await withTemporaryDatabase(async () => {
    await prepareWatchWorkspace();
    const active = await createActiveWatch("C-DOCS-FEEDBACK");
    const lifecycleContext: WatchLifecycleContext = {
      capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
      operator: OPERATOR,
      now: NOW,
    };
    await mutateWatchLifecycle({
      watchId: active.id,
      action: "pause",
      expectedStateRevision: active.stateRevision,
      operationKey: "pause-watch-admission-71",
      reason: "Verify paused events are rejected before content admission.",
    }, lifecycleContext);
    assert.deepEqual(
      await resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        ADMISSION_CONTEXT,
      ),
      [],
    );

    const expiring = await createActiveWatch("C-EXPIRING", "2026-07-14T00:00:00.000Z");
    assert.equal(expiring.effectiveRevision.policy.expiresAt, "2026-07-14T00:00:00.000Z");
    assert.deepEqual(
      await resolveActiveWatchEventAdmissions(lookup("C-EXPIRING"), {
        ...ADMISSION_CONTEXT,
        now: new Date("2026-07-14T00:00:01.000Z"),
      }),
      [],
    );
  });
});

test("provider, setup, storage, and active-state failures stop admission visibly", async () => {
  await withTemporaryDatabase(async () => {
    await assert.rejects(
      () => resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        { capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY, now: NOW },
      ),
      errorWithCode("provider-authorization-unavailable"),
    );
    await assert.rejects(
      () => resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        {
          ...ADMISSION_CONTEXT,
          providerAuthorization: {
            ...ADMISSION_CONTEXT.providerAuthorization,
            providerWorkspaceId: "T-OTHER",
          },
        },
      ),
      errorWithCode("provider-authorization-unavailable"),
    );
    await assert.rejects(
      () => resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        ADMISSION_CONTEXT,
      ),
      /canonical workspace setup/,
    );

    await prepareWatchWorkspace();
    const active = await createActiveWatch("C-DOCS-FEEDBACK");
    await withDocsAgentDatabase((db) =>
      db.update(policyBoundWatches)
        .set({ effectiveRevisionId: "00000000-0000-4000-8000-000000000071" })
        .where(eq(policyBoundWatches.id, active.id))
    );
    await assert.rejects(
      () => resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        ADMISSION_CONTEXT,
      ),
      errorWithCode("watch-state-invalid"),
    );

    await withDocsAgentDatabase((db) =>
      db.delete(workspaceSetup).where(eq(workspaceSetup.id, DEFAULT_WORKSPACE_ID))
    );
    await assert.rejects(
      () => resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        ADMISSION_CONTEXT,
      ),
      /canonical workspace setup/,
    );
  });
});

test("unmigrated watch storage fails before admission", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-admission-storage-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "unmigrated.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await assert.rejects(
      () => resolveActiveWatchEventAdmissions(
        lookup("C-DOCS-FEEDBACK"),
        ADMISSION_CONTEXT,
      ),
      /database schema is not ready|database is unavailable/i,
    );
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function createActiveWatch(
  channelId: string,
  expiresAt = "2026-08-13T00:00:00.000Z",
) {
  const proposed = await createProposedWatch({
    policy: policy(channelId, expiresAt),
    actor: { id: "author-71", githubLogin: "watch-author" },
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

function lookup(channelId: string) {
  return {
    workspaceId: DEFAULT_WORKSPACE_ID,
    providerWorkspaceId: PROVIDER_WORKSPACE_ID,
    source: {
      provider: "slack",
      resource: { type: "channel", id: channelId },
    },
    eventType: "message",
  } as const;
}

function policy(channelId: string, expiresAt: string): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
      resource: { type: "channel", id: channelId },
    },
    goal: "Find evidence-backed documentation gaps discussed in this channel.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
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
    expiresAt,
  };
}

function errorWithCode(code: WatchEventAdmissionError["code"]) {
  return (error: unknown) =>
    error instanceof WatchEventAdmissionError && error.code === code;
}

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-watch-admission-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "admission.sqlite")}`;
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
