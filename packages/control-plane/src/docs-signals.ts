import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase, type DocsAgentDatabase } from "./db/client.ts";
import {
  docsSignalArtifacts,
  docsSignalEvents,
  docsSignalLinks,
  docsSignalOwnedWork,
  docsSignalSources,
  docsSignals,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import {
  assertDocsSignalTransitionReady,
  DocsSignalTransitionError,
  docsSignalStatusSchema,
  type DocsSignalStatus,
  type DocsSignalTransitionAuthority,
} from "./docs-signal-lifecycle.ts";
import { ownedDocsWorkRecordSchema } from "./owned-docs-work-contract.ts";
import { resolveSlackThreadPresencesForSignalSources } from "./slack-thread-presence.ts";

export { docsSignalStatusSchema, type DocsSignalStatus } from "./docs-signal-lifecycle.ts";

const nowIso = () => new Date().toISOString();
type DocsAgentDatabaseExecutor = Pick<
  DocsAgentDatabase,
  "select" | "insert" | "update"
>;

export const openDocsSignalStatuses = [
  "captured",
  "needs-maintainer-answer",
  "needs-source-evidence",
  "verification-skipped",
  "docs-verified",
  "patch-failed",
  "patch-prepared",
  "draft-pr-opened",
] as const satisfies readonly DocsSignalStatus[];

export const docsSignalSourceKindSchema = z.enum([
  "slack-thread",
  "linear-issue",
  "watched-release",
  "scheduled-scan",
  "manual-scenario",
  "external-context",
]);

export const docsSignalLinkKindSchema = z.enum([
  "repository",
  "release",
  "pull-request",
  "issue",
  "slack-thread",
  "linear-issue",
  "docs-page",
  "other",
]);

export const docsSignalArtifactKindSchema = z.enum([
  "verification-report",
  "impact-report",
  "editorial-recommendation",
  "content-plan",
  "authoring-draft",
  "validation-result",
  "approval-request",
  "publication",
  "diff",
  "draft-pr",
  "check-log",
  "other",
]);

export const docsSignalSourceInputSchema = z.object({
  kind: docsSignalSourceKindSchema,
  provider: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  permalink: z.string().url().optional(),
  title: z.string().trim().min(1).optional(),
  authors: z.array(z.string().trim().min(1)).default([]),
  sourceText: z.string().trim().min(1).optional(),
  sourceCreatedAt: z.string().trim().min(1).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
  capturedAt: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const docsSignalLinkInputSchema = z.object({
  kind: docsSignalLinkKindSchema,
  label: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
  externalId: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const docsSignalArtifactInputSchema = z.object({
  kind: docsSignalArtifactKindSchema,
  label: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
  path: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createDocsSignalInputSchema = z.object({
  source: docsSignalSourceInputSchema,
  sourceSummary: z.string().trim().min(1),
  extractedClaims: z.array(z.string().trim().min(1)).default([]),
  likelyDocsConcepts: z.array(z.string().trim().min(1)).default([]),
  likelyDocsPages: z.array(z.string().trim().min(1)).default([]),
  productSurfaces: z.array(z.string().trim().min(1)).default([]),
  missingEvidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.string().trim().min(1).optional(),
  priority: z.number().int().min(0).max(100).default(0),
  nextActionAt: z.string().trim().min(1).optional(),
  links: z.array(docsSignalLinkInputSchema).default([]),
  artifacts: z.array(docsSignalArtifactInputSchema).default([]),
}).strict();

const docsSignalLifecycleUpdateFields = {
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  missingEvidence: z.array(z.string().trim().min(1)).optional(),
  uncertainty: z.string().trim().min(1).optional(),
  nextActionAt: z.string().trim().min(1).nullable().optional(),
  links: z.array(docsSignalLinkInputSchema).default([]),
  artifacts: z.array(docsSignalArtifactInputSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
};

const triageDocsSignalStatusSchema = z.enum([
  "captured",
  "needs-maintainer-answer",
  "needs-source-evidence",
]);

export const updateDocsSignalLifecycleInputSchema = z.object({
  ...docsSignalLifecycleUpdateFields,
  status: triageDocsSignalStatusSchema,
}).strict();

const transitionDocsSignalLifecycleInputSchema = z.object({
  ...docsSignalLifecycleUpdateFields,
  status: docsSignalStatusSchema,
  actor: z.string().trim().min(1),
}).strict();

const initialDocsSignalLifecycleSchema = z.object({
  status: docsSignalStatusSchema,
  reason: z.string().trim().min(1),
  actor: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const listDocsSignalsInputSchema = z.object({
  statuses: z.array(docsSignalStatusSchema).default([]),
  sourceKinds: z.array(docsSignalSourceKindSchema).default([]),
  openOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getDocsSignalInputSchema = z.object({
  id: z.string().trim().min(1),
});

export const recordDocsSignalEvidenceInputSchema = z.object({
  id: z.string().trim().min(1),
  expectedUpdatedAt: z.string().trim().min(1),
  operationKey: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(2_000),
  links: z.array(docsSignalLinkInputSchema).max(50).default([]),
  artifacts: z.array(docsSignalArtifactInputSchema).max(20).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

const docsSignalRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  status: docsSignalStatusSchema,
  sourceKind: docsSignalSourceKindSchema,
  dedupeKey: z.string().nullable(),
  sourceSummary: z.string(),
  extractedClaims: z.array(z.string()),
  likelyDocsConcepts: z.array(z.string()),
  likelyDocsPages: z.array(z.string()),
  productSurfaces: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  uncertainty: z.string().nullable(),
  priority: z.number().int(),
  nextActionAt: z.string().nullable(),
  capturedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const docsSignalSourceRecordSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  workspaceId: z.string(),
  kind: docsSignalSourceKindSchema,
  provider: z.string().nullable(),
  providerId: z.string().nullable(),
  permalink: z.string().nullable(),
  title: z.string().nullable(),
  authors: z.array(z.string()),
  sourceText: z.string().nullable(),
  sourceCreatedAt: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  capturedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const docsSignalLinkRecordSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  workspaceId: z.string(),
  kind: docsSignalLinkKindSchema,
  label: z.string().nullable(),
  url: z.string().nullable(),
  externalId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const docsSignalArtifactRecordSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  workspaceId: z.string(),
  kind: docsSignalArtifactKindSchema,
  label: z.string().nullable(),
  url: z.string().nullable(),
  path: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const docsSignalEventRecordSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  workspaceId: z.string(),
  eventType: z.string(),
  fromStatus: docsSignalStatusSchema.nullable(),
  toStatus: docsSignalStatusSchema.nullable(),
  reason: z.string(),
  actor: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const docsSignalDetailSchema = docsSignalRecordSchema.extend({
  sources: z.array(docsSignalSourceRecordSchema),
  links: z.array(docsSignalLinkRecordSchema),
  artifacts: z.array(docsSignalArtifactRecordSchema),
  events: z.array(docsSignalEventRecordSchema),
  ownedWork: ownedDocsWorkRecordSchema.nullable(),
});

export const createDocsSignalResultSchema = z.object({
  created: z.boolean(),
  signal: docsSignalDetailSchema,
});

export const recordDocsSignalEvidenceResultSchema = z.object({
  replayed: z.boolean(),
  signal: docsSignalDetailSchema,
});

export const listDocsSignalsResultSchema = z.object({
  signals: z.array(docsSignalRecordSchema),
});

export const docsSignalQueueItemSchema = docsSignalRecordSchema.pick({
  id: true,
  status: true,
  sourceKind: true,
  sourceSummary: true,
  uncertainty: true,
  priority: true,
  nextActionAt: true,
  updatedAt: true,
});

export const listDocsSignalQueueResultSchema = z.object({
  signals: z.array(docsSignalQueueItemSchema),
});

export type DocsSignalSourceKind = z.infer<typeof docsSignalSourceKindSchema>;
export type DocsSignalRecord = z.infer<typeof docsSignalRecordSchema>;
export type DocsSignalQueueItem = z.infer<typeof docsSignalQueueItemSchema>;
export type DocsSignalDetail = z.infer<typeof docsSignalDetailSchema>;
export type CreateDocsSignalInput = z.infer<typeof createDocsSignalInputSchema>;
export type UpdateDocsSignalLifecycleInput = z.infer<
  typeof updateDocsSignalLifecycleInputSchema
>;
export type TransitionDocsSignalLifecycleInput = z.infer<
  typeof transitionDocsSignalLifecycleInputSchema
>;
export type InitialDocsSignalLifecycle = z.input<
  typeof initialDocsSignalLifecycleSchema
>;
export type ListDocsSignalsInput = z.infer<typeof listDocsSignalsInputSchema>;

export async function createDocsSignal(
  input: CreateDocsSignalInput,
): Promise<z.infer<typeof createDocsSignalResultSchema>> {
  return captureDocsSignal(input, {
    status: "captured",
    reason: "Docs signal captured.",
    actor: "docs-agent",
  });
}

export async function captureDocsSignal(
  input: CreateDocsSignalInput,
  initialLifecycle: InitialDocsSignalLifecycle,
): Promise<z.infer<typeof createDocsSignalResultSchema>> {
  const parsed = createDocsSignalInputSchema.parse(input);
  const lifecycle = initialDocsSignalLifecycleSchema.parse(initialLifecycle);
  const dedupeKey = buildDedupeKey(parsed.source);
  assertDocsSignalTransitionReady({
    authority: "intake",
    from: "captured",
    to: lifecycle.status,
    missingEvidence: parsed.missingEvidence,
  });

  return withDocsAgentDatabase(async (db) => {
    return db.transaction(async (tx) => {
      const signalId = randomUUID();
      const capturedAt = parsed.source.capturedAt ?? nowIso();
      const createdAt = nowIso();
      const insert = tx.insert(docsSignals).values({
        id: signalId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        status: lifecycle.status,
        sourceKind: parsed.source.kind,
        dedupeKey,
        sourceSummary: parsed.sourceSummary,
        extractedClaims: parsed.extractedClaims,
        likelyDocsConcepts: parsed.likelyDocsConcepts,
        likelyDocsPages: parsed.likelyDocsPages,
        productSurfaces: parsed.productSurfaces,
        missingEvidence: parsed.missingEvidence,
        uncertainty: parsed.uncertainty ?? null,
        priority: parsed.priority,
        nextActionAt: parsed.nextActionAt ?? null,
        capturedAt,
        createdAt,
        updatedAt: createdAt,
      });
      const insertedRows = dedupeKey === null
        ? await insert.returning({ id: docsSignals.id })
        : await insert
            .onConflictDoNothing({
              target: [docsSignals.workspaceId, docsSignals.dedupeKey],
            })
            .returning({ id: docsSignals.id });

      if (insertedRows.length === 0) {
        const existing = dedupeKey === null
          ? null
          : await findSignalByDedupeKey(tx, dedupeKey);
        if (existing === null) {
          throw new Error("Docs signal insert conflicted without a matching dedupe key.");
        }
        const signal = await readDocsSignalDetail(tx, existing.id);
        if (!isOpenDocsSignalStatus(signal.status)) {
          await resolveSlackThreadPresencesForSignalSources(tx, {
            signalId: signal.id,
            nowMs: Date.parse(createdAt),
          });
        }
        return createDocsSignalResultSchema.parse({
          created: false,
          signal,
        });
      }

      await insertSource(tx, signalId, parsed.source, capturedAt);
      await insertLinks(tx, signalId, parsed.links);
      await insertArtifacts(tx, signalId, parsed.artifacts);
      await insertEvent(tx, {
        signalId,
        eventType: "signal-created",
        fromStatus: null,
        toStatus: lifecycle.status,
        reason: lifecycle.reason,
        actor: lifecycle.actor,
        metadata: {
          ...lifecycle.metadata,
          dedupeKey,
        },
      });

      if (!isOpenDocsSignalStatus(lifecycle.status)) {
        await resolveSlackThreadPresencesForSignalSources(tx, {
          signalId,
          nowMs: Date.parse(createdAt),
        });
      }

      return createDocsSignalResultSchema.parse({
        created: true,
        signal: await readDocsSignalDetail(tx, signalId),
      });
    });
  });
}

export async function listDocsSignals(
  input: Partial<ListDocsSignalsInput> = {},
): Promise<z.infer<typeof listDocsSignalsResultSchema>> {
  const parsed = listDocsSignalsInputSchema.parse(input);

  return withDocsAgentDatabase(async (db) => {
    const conditions: SQL[] = [eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID)];

    if (parsed.statuses.length > 0) {
      conditions.push(inArray(docsSignals.status, parsed.statuses));
    } else if (parsed.openOnly) {
      conditions.push(
        inArray(docsSignals.status, [...openDocsSignalStatuses]),
      );
    }

    if (parsed.sourceKinds.length > 0) {
      conditions.push(inArray(docsSignals.sourceKind, parsed.sourceKinds));
    }

    const rows = await db
      .select()
      .from(docsSignals)
      .where(and(...conditions))
      .orderBy(
        desc(docsSignals.priority),
        desc(docsSignals.updatedAt),
        asc(docsSignals.id),
      )
      .limit(parsed.limit);

    return listDocsSignalsResultSchema.parse({
      signals: rows.map(parseSignalRow),
    });
  });
}

export async function listDocsSignalQueue(
  input: Partial<ListDocsSignalsInput> = {},
): Promise<z.infer<typeof listDocsSignalQueueResultSchema>> {
  const result = await listDocsSignals(input);

  return listDocsSignalQueueResultSchema.parse({
    signals: result.signals.map((signal) => ({
      id: signal.id,
      status: signal.status,
      sourceKind: signal.sourceKind,
      sourceSummary: signal.sourceSummary,
      uncertainty: signal.uncertainty,
      priority: signal.priority,
      nextActionAt: signal.nextActionAt,
      updatedAt: signal.updatedAt,
    })),
  });
}

export async function getDocsSignal(input: {
  id: string;
}): Promise<DocsSignalDetail> {
  const parsed = getDocsSignalInputSchema.parse(input);

  return withDocsAgentDatabase((db) => readDocsSignalDetail(db, parsed.id));
}

export async function updateDocsSignalLifecycle(
  input: UpdateDocsSignalLifecycleInput,
): Promise<DocsSignalDetail> {
  const parsed = updateDocsSignalLifecycleInputSchema.parse(input);

  return transitionDocsSignalLifecycle(
    {
      ...parsed,
      actor: "docs-agent:lifecycle-tool",
    },
    "triage",
  );
}

export async function recordDocsSignalEvidence(
  input: z.infer<typeof recordDocsSignalEvidenceInputSchema>,
): Promise<z.infer<typeof recordDocsSignalEvidenceResultSchema>> {
  const parsed = recordDocsSignalEvidenceInputSchema.parse(input);

  return withDocsAgentDatabase(async (db) => {
    const replayed = await db.transaction(async (tx) => {
      const current = await readDocsSignalRecord(tx, parsed.id);
      const priorEvents = await tx
        .select({ metadata: docsSignalEvents.metadata })
        .from(docsSignalEvents)
        .where(
          and(
            eq(docsSignalEvents.workspaceId, DEFAULT_WORKSPACE_ID),
            eq(docsSignalEvents.signalId, parsed.id),
            eq(docsSignalEvents.eventType, "evidence-linked"),
          ),
        );
      if (
        priorEvents.some(
          ({ metadata }) =>
            typeof metadata === "object" &&
            metadata !== null &&
            "operationKey" in metadata &&
            metadata.operationKey === parsed.operationKey,
        )
      ) {
        return true;
      }
      if (current.updatedAt !== parsed.expectedUpdatedAt) {
        throw new DocsSignalTransitionError(
          `Docs signal ${parsed.id} changed concurrently. Expected revision ${parsed.expectedUpdatedAt}, found ${current.updatedAt}. Inspect and retry the same work item.`,
        );
      }

      const updatedRows = await tx
        .update(docsSignals)
        .set({ updatedAt: nextIsoTimestamp(current.updatedAt) })
        .where(
          and(
            eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID),
            eq(docsSignals.id, parsed.id),
            eq(docsSignals.status, current.status),
            eq(docsSignals.updatedAt, parsed.expectedUpdatedAt),
          ),
        )
        .returning({ id: docsSignals.id });
      if (updatedRows.length !== 1) {
        throw new DocsSignalTransitionError(
          `Docs signal ${parsed.id} changed while evidence was linked. Inspect and retry.`,
        );
      }

      await insertLinks(tx, parsed.id, parsed.links);
      await insertArtifacts(tx, parsed.id, parsed.artifacts);
      await insertEvent(tx, {
        signalId: parsed.id,
        eventType: "evidence-linked",
        fromStatus: current.status,
        toStatus: current.status,
        reason: parsed.reason,
        actor: "docs-agent:docs-work",
        metadata: { ...parsed.metadata, operationKey: parsed.operationKey },
      });
      return false;
    });

    return recordDocsSignalEvidenceResultSchema.parse({
      replayed,
      signal: await readDocsSignalDetail(db, parsed.id),
    });
  });
}

function nextIsoTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export async function transitionDocsSignalLifecycle(
  input: TransitionDocsSignalLifecycleInput,
  authority: DocsSignalTransitionAuthority,
): Promise<DocsSignalDetail> {
  const parsed = transitionDocsSignalLifecycleInputSchema.parse(input);

  return withDocsAgentDatabase(async (db) => {
    await db.transaction(async (tx) => {
      const current = await readDocsSignalRecord(tx, parsed.id);
      const missingEvidence = parsed.missingEvidence ?? current.missingEvidence;
      assertDocsSignalTransitionReady({
        authority,
        from: current.status,
        to: parsed.status,
        missingEvidence,
      });
      const updatedAt = nowIso();

      const updatedRows = await tx
        .update(docsSignals)
        .set({
          status: parsed.status,
          missingEvidence,
          uncertainty: parsed.uncertainty ?? current.uncertainty,
          nextActionAt:
            parsed.nextActionAt === undefined ? current.nextActionAt : parsed.nextActionAt,
          updatedAt,
        })
        .where(
          and(
            eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID),
            eq(docsSignals.id, parsed.id),
            eq(docsSignals.status, current.status),
          ),
        )
        .returning({ id: docsSignals.id });

      if (updatedRows.length !== 1) {
        throw new DocsSignalTransitionError(
          `Docs signal ${parsed.id} changed while applying ${current.status} -> ${parsed.status}.`,
        );
      }

      await insertLinks(tx, parsed.id, parsed.links);
      await insertArtifacts(tx, parsed.id, parsed.artifacts);
      await insertEvent(tx, {
        signalId: parsed.id,
        eventType: "lifecycle-updated",
        fromStatus: current.status,
        toStatus: parsed.status,
        reason: parsed.reason,
        actor: parsed.actor,
        metadata: parsed.metadata,
      });

      if (!isOpenDocsSignalStatus(parsed.status)) {
        await resolveSlackThreadPresencesForSignalSources(tx, {
          signalId: parsed.id,
          nowMs: Date.parse(updatedAt),
        });
      }
    });

    return readDocsSignalDetail(db, parsed.id);
  });
}

function isOpenDocsSignalStatus(status: DocsSignalStatus): boolean {
  return (openDocsSignalStatuses as readonly string[]).includes(status);
}

async function findSignalByDedupeKey(
  db: DocsAgentDatabaseExecutor,
  dedupeKey: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: docsSignals.id })
    .from(docsSignals)
    .where(
      and(
        eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(docsSignals.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function readDocsSignalDetail(
  db: DocsAgentDatabaseExecutor,
  id: string,
): Promise<DocsSignalDetail> {
  const signal = await readDocsSignalRecord(db, id);

  const [sources, links, artifacts, events, ownedWork] = await Promise.all([
    db
      .select()
      .from(docsSignalSources)
      .where(eq(docsSignalSources.signalId, id))
      .orderBy(desc(docsSignalSources.createdAt)),
    db
      .select()
      .from(docsSignalLinks)
      .where(eq(docsSignalLinks.signalId, id))
      .orderBy(desc(docsSignalLinks.createdAt)),
    db
      .select()
      .from(docsSignalArtifacts)
      .where(eq(docsSignalArtifacts.signalId, id))
      .orderBy(desc(docsSignalArtifacts.createdAt)),
    db
      .select()
      .from(docsSignalEvents)
      .where(eq(docsSignalEvents.signalId, id))
      .orderBy(desc(docsSignalEvents.createdAt)),
    db
      .select()
      .from(docsSignalOwnedWork)
      .where(eq(docsSignalOwnedWork.signalId, id))
      .limit(1),
  ]);

  return docsSignalDetailSchema.parse({
    ...signal,
    sources: sources.map(parseSourceRow),
    links: links.map(parseLinkRow),
    artifacts: artifacts.map(parseArtifactRow),
    events: events.map(parseEventRow),
    ownedWork: ownedWork[0] === undefined ? null : ownedDocsWorkRecordSchema.parse(ownedWork[0]),
  });
}

async function readDocsSignalRecord(
  db: DocsAgentDatabaseExecutor,
  id: string,
): Promise<z.infer<typeof docsSignalRecordSchema>> {
  const rows = await db
    .select()
    .from(docsSignals)
    .where(
      and(
        eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(docsSignals.id, id),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error(`Docs signal not found: ${id}`);

  return parseSignalRow(row);
}

async function insertSource(
  db: DocsAgentDatabaseExecutor,
  signalId: string,
  source: z.infer<typeof docsSignalSourceInputSchema>,
  capturedAt: string,
): Promise<void> {
  await db.insert(docsSignalSources).values({
    id: randomUUID(),
    signalId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    sourceKind: source.kind,
    provider: source.provider ?? null,
    providerId: source.providerId ?? null,
    permalink: source.permalink ?? null,
    title: source.title ?? null,
    authors: source.authors,
    sourceText: source.sourceText ?? null,
    sourceCreatedAt: source.sourceCreatedAt ?? null,
    sourceUpdatedAt: source.sourceUpdatedAt ?? null,
    capturedAt,
    metadata: source.metadata,
    createdAt: nowIso(),
  });
}

async function insertLinks(
  db: DocsAgentDatabaseExecutor,
  signalId: string,
  links: z.infer<typeof docsSignalLinkInputSchema>[],
): Promise<void> {
  if (links.length === 0) return;

  await db.insert(docsSignalLinks).values(
    links.map((link) => ({
      id: randomUUID(),
      signalId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      kind: link.kind,
      label: link.label ?? null,
      url: link.url ?? null,
      externalId: link.externalId ?? null,
      metadata: link.metadata,
      createdAt: nowIso(),
    })),
  );
}

async function insertArtifacts(
  db: DocsAgentDatabaseExecutor,
  signalId: string,
  artifacts: z.infer<typeof docsSignalArtifactInputSchema>[],
): Promise<void> {
  if (artifacts.length === 0) return;

  await db.insert(docsSignalArtifacts).values(
    artifacts.map((artifact) => ({
      id: randomUUID(),
      signalId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      kind: artifact.kind,
      label: artifact.label ?? null,
      url: artifact.url ?? null,
      path: artifact.path ?? null,
      metadata: artifact.metadata,
      createdAt: nowIso(),
    })),
  );
}

async function insertEvent(
  db: DocsAgentDatabaseExecutor,
  event: {
    signalId: string;
    eventType: string;
    fromStatus: DocsSignalStatus | null;
    toStatus: DocsSignalStatus | null;
    reason: string;
    actor: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(docsSignalEvents).values({
    id: randomUUID(),
    signalId: event.signalId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    eventType: event.eventType,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reason: event.reason,
    actor: event.actor,
    metadata: event.metadata,
    createdAt: nowIso(),
  });
}

function buildDedupeKey(
  source: z.infer<typeof docsSignalSourceInputSchema>,
): string | null {
  if (source.provider !== undefined && source.providerId !== undefined) {
    return `${source.kind}:${source.provider}:${source.providerId}`;
  }

  if (source.permalink !== undefined) {
    return `${source.kind}:permalink:${source.permalink}`;
  }

  return null;
}

function parseSignalRow(row: typeof docsSignals.$inferSelect) {
  return docsSignalRecordSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    status: row.status,
    sourceKind: row.sourceKind,
    dedupeKey: row.dedupeKey,
    sourceSummary: row.sourceSummary,
    extractedClaims: row.extractedClaims,
    likelyDocsConcepts: row.likelyDocsConcepts,
    likelyDocsPages: row.likelyDocsPages,
    productSurfaces: row.productSurfaces,
    missingEvidence: row.missingEvidence,
    uncertainty: row.uncertainty,
    priority: row.priority,
    nextActionAt: row.nextActionAt,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function parseSourceRow(row: typeof docsSignalSources.$inferSelect) {
  return docsSignalSourceRecordSchema.parse({
    id: row.id,
    signalId: row.signalId,
    workspaceId: row.workspaceId,
    kind: row.sourceKind,
    provider: row.provider,
    providerId: row.providerId,
    permalink: row.permalink,
    title: row.title,
    authors: row.authors,
    sourceText: row.sourceText,
    sourceCreatedAt: row.sourceCreatedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    capturedAt: row.capturedAt,
    metadata: row.metadata,
    createdAt: row.createdAt,
  });
}

function parseLinkRow(row: typeof docsSignalLinks.$inferSelect) {
  return docsSignalLinkRecordSchema.parse({
    id: row.id,
    signalId: row.signalId,
    workspaceId: row.workspaceId,
    kind: row.kind,
    label: row.label,
    url: row.url,
    externalId: row.externalId,
    metadata: row.metadata,
    createdAt: row.createdAt,
  });
}

function parseArtifactRow(row: typeof docsSignalArtifacts.$inferSelect) {
  return docsSignalArtifactRecordSchema.parse({
    id: row.id,
    signalId: row.signalId,
    workspaceId: row.workspaceId,
    kind: row.kind,
    label: row.label,
    url: row.url,
    path: row.path,
    metadata: row.metadata,
    createdAt: row.createdAt,
  });
}

function parseEventRow(row: typeof docsSignalEvents.$inferSelect) {
  return docsSignalEventRecordSchema.parse({
    id: row.id,
    signalId: row.signalId,
    workspaceId: row.workspaceId,
    eventType: row.eventType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    actor: row.actor,
    metadata: row.metadata,
    createdAt: row.createdAt,
  });
}
