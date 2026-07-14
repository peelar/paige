import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import type { WatchCapabilityRegistry } from "@docs-agent/control-plane/agent";
import type {
  ActivePolicyBoundWatch,
  ProposedWatchPolicy,
} from "@docs-agent/control-plane/testing";

const evalDataDir = mkdtempSync(join(tmpdir(), "paige-watch-continuity-eval-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(evalDataDir, "continuity.sqlite")}`;
const FIRST_RAW_OBSERVATION =
  "The release channel reports that v3.0.0 is now public. Keep this as a provider claim, not official release proof, and retain the open verification question.";
const controlPlaneAgentModule = "@docs-agent/control-plane/agent";
const controlPlaneTestingModule = "@docs-agent/control-plane/testing";
const {
  assembleClaimedWatchObservation,
  claimWatchObservation,
  createEphemeralWatchObservation,
  createInternalDocument,
  DEFAULT_WORKSPACE_ID,
  findInternalDocumentByAttachment,
  prepareWatchDispatch,
  saveWorkingRepositorySetup,
} = await import(controlPlaneAgentModule);
const {
  approveWatchProposal,
  createProposedWatch,
  migrateDocsAgentDatabase,
} = await import(controlPlaneTestingModule);
await migrateDocsAgentDatabase();

const CAPABILITY_REGISTRY: WatchCapabilityRegistry = {
  version: 1,
  status: "ready",
  availableCapabilities: [
    "knowledge.read",
    "repository.read",
    "docs_work.manage",
    "draft.edit",
    "follow_up.schedule",
    "provider.deliver",
  ],
};

export default defineEval({
  description: "Fresh watch sessions revise one continuity document and leave no-op occurrences unchanged",
  tags: ["issue-77", "watch", "continuity", "skill-routing"],
  timeoutMs: 600_000,
  async test(t) {
    const active = await createActiveWatch();
    const seeded = await createInternalDocument({
      title: "Watch continuity",
      kind: "watch-continuity",
      editingProfile: "living-summary",
      content: [
        "# Evidence",
        "",
        "No official release evidence has been inspected.",
        "",
        "# Hypotheses",
        "",
        "The channel says the public release may be ready.",
        "",
        "# Open questions",
        "",
        "Is the release actually published?",
      ].join("\n"),
      retentionDays: 30,
      attachment: continuityAttachment(active.id),
      sourceReferences: [{ kind: "policy-bound-watch", id: active.id }],
    }, command("seed-continuity", "eval-seed", "eval-seed"));

    const first = await runOccurrence(
      t,
      active,
      FIRST_RAW_OBSERVATION,
      "first",
    );
    first.loadedSkill("watch-execution", { count: 1 });
    first.calledTool("internal_document", {
      input: (input) => isModeForDocument(input, "read", seeded.document.id),
    });
    first.calledTool("internal_document", {
      input: (input) => isModeForDocument(input, "update", seeded.document.id),
      output: (output) => {
        const content = documentContent(output).toLowerCase();
        return content.includes("provider") &&
          content.includes("v3.0.0") &&
          content.includes("open") &&
          !content.includes(FIRST_RAW_OBSERVATION.toLowerCase()) &&
          !content.includes("no official release evidence has been inspected");
      },
      count: 1,
    });
    const afterFirst = await readContinuity(active.id, "read-after-first");

    const noOp = await runOccurrence(
      t,
      active,
      "Thanks. This adds no release evidence, correction, hypothesis, or open question.",
      "noop",
    );
    noOp.loadedSkill("watch-execution", { count: 1 });
    noOp.calledTool("internal_document", {
      input: (input) => isModeForDocument(input, "read", seeded.document.id),
    });
    noOp.calledTool("internal_document", {
      input: (input) => isRecord(input) && input.mode === "update",
      count: 0,
    });
    const afterNoOp = await readContinuity(active.id, "read-after-noop");
    t.check(
      afterNoOp.currentRevision,
      satisfies(
        (revision) => revision === afterFirst.currentRevision,
        "the no-op occurrence leaves the continuity revision unchanged",
      ),
    );

    const correction = await runOccurrence(
      t,
      active,
      "Correction: the channel claim was superseded. v3.0.0 is not public and the rollout is postponed. Keep official release verification open.",
      "correction",
    );
    correction.loadedSkill("watch-execution", { count: 1 });
    correction.calledTool("internal_document", {
      input: (input) => isModeForDocument(input, "read", seeded.document.id),
    });
    correction.calledTool("internal_document", {
      input: (input) => isModeForDocument(input, "update", seeded.document.id),
      output: (output) => {
        const content = documentContent(output).toLowerCase();
        return content.includes("postponed") &&
          content.includes("not public") &&
          !content.includes("now public");
      },
      count: 1,
    });
    const afterCorrection = await readContinuity(active.id, "read-after-correction");
    t.check(
      afterCorrection.id,
      satisfies(
        (documentId) => documentId === seeded.document.id,
        "every fresh watch session receives the same attached document",
      ),
    );
    t.check(
      afterCorrection.revisions.at(-1)?.sourceReferences,
      satisfies(
        (references) => Array.isArray(references) &&
          references.some((reference) => isRecord(reference) && reference.kind === "policy-bound-watch" && reference.id === active.id) &&
          references.some((reference) => isRecord(reference) && reference.kind === "watch-effective-revision" && reference.id === active.effectiveRevision.id) &&
          references.some((reference) => isRecord(reference) && reference.kind === "watch-occurrence"),
        "continuity changes retain server-owned watch, revision, and occurrence provenance",
      ),
    );

    t.succeeded();
    t.noFailedActions();
  },
});

async function runOccurrence(
  t: Parameters<NonNullable<Parameters<typeof defineEval>[0]["test"]>>[0],
  active: ActivePolicyBoundWatch,
  text: string,
  occurrence: string,
) {
  const now = new Date();
  const observation = createEphemeralWatchObservation({
    watchId: active.id,
    effectiveRevisionId: active.effectiveRevision.id,
    source: active.effectiveRevision.policy.source,
    actor: { kind: "user", id: "U-WATCH-77" },
    occurredAt: now.toISOString(),
    eventType: "message",
    thread: null,
    permalink: `https://example.slack.com/archives/C-WATCH-77/p${occurrence}`,
    provenance: {
      ingress: "provider-adapter",
      providerWorkspaceId: "T-DOCS",
      providerEventId: `slack:T-DOCS:C-WATCH-77:${occurrence}`,
      receivedAt: now.toISOString(),
      adapter: { name: "slack-events", version: "1" },
    },
    content: { text, mediaType: "text/plain" },
  }, active.effectiveRevision);
  const claim = await claimWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    watchId: active.id,
    effectiveRevisionId: active.effectiveRevision.id,
    source: active.effectiveRevision.policy.source,
    providerEventId: observation.provenance.providerEventId,
  }, { now });
  const assembled = await assembleClaimedWatchObservation({
    workspaceId: DEFAULT_WORKSPACE_ID,
    claimResult: claim,
    observation,
  }, { now });
  const handoff = assembled.handoffs[0];
  if (handoff === undefined) throw new Error("Expected a ready watch handoff.");
  await prepareWatchDispatch(handoff, {
    capabilityRegistry: CAPABILITY_REGISTRY,
    providerAuthorization: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      verification: "verified-webhook",
    },
    now,
  });
  const dispatched = await t.target.dispatchSchedule("watch-runtime");
  const sessionIds = await t.require(
    dispatched.sessionIds,
    satisfies(
      (ids: unknown) => Array.isArray(ids) && ids.length === 1,
      "one watch occurrence starts one fresh session",
    ),
  );
  return t.target.attachSession(sessionIds[0]!);
}

async function createActiveWatch(): Promise<ActivePolicyBoundWatch> {
  const now = new Date();
  await saveWorkingRepositorySetup({
    workingDocumentationRepository: {
      source: { type: "github-url", url: "https://github.com/example/docs.git" },
      ref: "main",
      sandboxPath: "/workspace/working-docs-watch-continuity",
      accessMode: "sandbox-write",
      allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
      provenanceLabel: "working-documentation-repository",
    },
    watchedRepositories: [],
    contextRepositories: [],
    externalContext: [],
  });
  const proposed = await createProposedWatch({
    policy: policy(now),
    actor: { id: "author-77", githubLogin: "watch-author" },
  }, { capabilityRegistry: CAPABILITY_REGISTRY, now });
  return (await approveWatchProposal({
    watchId: proposed.id,
    proposalRevisionId: proposed.latestProposal.id,
    expectedProposalRevision: proposed.latestProposal.revision,
    decision: "approved",
    idempotencyKey: `approve-${proposed.id}`,
  }, {
    capabilityRegistry: CAPABILITY_REGISTRY,
    operator: { id: "operator-77", githubLogin: "docs-owner" },
    now,
  })).watch;
}

function policy(now: Date): ProposedWatchPolicy {
  return {
    source: {
      provider: "slack",
      providerWorkspaceId: "T-DOCS",
      resource: { type: "channel", id: "C-WATCH-77" },
    },
    goal: "Maintain a concise living summary of release status from channel reports while keeping provider claims separate from official release proof.",
    trigger: { type: "on_event" },
    evaluation: { mode: "per_event" },
    delivery: { mode: "silent" },
    context: {
      eventTypes: ["message"],
      includeThread: false,
      historyMessageLimit: 0,
      maxCharacters: 12_000,
    },
    capabilityGrants: ["docs_work.manage"],
    retention: { rawObservationSeconds: 1_800, auditDays: 30 },
    budgets: {
      observationsPerHour: 60,
      processingRunsPerHour: 12,
      deliveriesPerDay: 0,
      inputCharactersPerHour: 120_000,
    },
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
  };
}

function continuityAttachment(watchId: string) {
  return {
    resourceType: "policy-bound-watch" as const,
    resourceId: watchId,
    relationship: "continuity" as const,
  };
}

function command(operationKey: string, sessionId: string, runId: string) {
  return {
    authority: "docs_work.manage" as const,
    actor: { type: "agent" as const, id: "paige-agent" },
    sessionId,
    runId,
    operationKey,
  };
}

async function readContinuity(watchId: string, operationKey: string) {
  const document = await findInternalDocumentByAttachment(
    { attachment: continuityAttachment(watchId) },
    command(operationKey, "eval-inspection", operationKey),
  );
  if (document === null) throw new Error("Expected watch continuity to remain attached.");
  return document;
}

function isModeForDocument(input: unknown, mode: string, documentId: string): boolean {
  return isRecord(input) && input.mode === mode && input.documentId === documentId;
}

function documentContent(output: unknown): string {
  const value = unwrapModelOutput(output);
  return isRecord(value) && isRecord(value.document)
    ? String(value.document.content ?? "")
    : "";
}

function unwrapModelOutput(value: unknown): unknown {
  return isRecord(value) && value.type === "json" && "value" in value
    ? value.value
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
