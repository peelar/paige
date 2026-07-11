import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase, type DocsAgentDatabase } from "./db/client.js";
import {
  docsSignalArtifacts,
  docsSignalEvents,
  docsSignalLinks,
  docsSignalSources,
  docsSignals,
} from "./db/schema.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";
import {
  assertDocsSignalTransitionReady,
  DocsSignalTransitionError,
  docsSignalStatusSchema,
  type DocsSignalStatus,
  type DocsSignalTransitionAuthority,
} from "./docs-signal-lifecycle.js";

export { docsSignalStatusSchema, type DocsSignalStatus } from "./docs-signal-lifecycle.js";

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

export const listDocsSignalsInputSchema = z.object({
  statuses: z.array(docsSignalStatusSchema).default([]),
  sourceKinds: z.array(docsSignalSourceKindSchema).default([]),
  openOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getDocsSignalInputSchema = z.object({
  id: z.string().trim().min(1),
});

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
});

export const createDocsSignalResultSchema = z.object({
  created: z.boolean(),
  signal: docsSignalDetailSchema,
});

export const listDocsSignalsResultSchema = z.object({
  signals: z.array(docsSignalRecordSchema),
});

export type DocsSignalSourceKind = z.infer<typeof docsSignalSourceKindSchema>;
export type DocsSignalDetail = z.infer<typeof docsSignalDetailSchema>;
export type CreateDocsSignalInput = z.infer<typeof createDocsSignalInputSchema>;
export type UpdateDocsSignalLifecycleInput = z.infer<
  typeof updateDocsSignalLifecycleInputSchema
>;
export type TransitionDocsSignalLifecycleInput = z.infer<
  typeof transitionDocsSignalLifecycleInputSchema
>;
export type ListDocsSignalsInput = z.infer<typeof listDocsSignalsInputSchema>;

export async function createDocsSignal(
  input: CreateDocsSignalInput,
): Promise<z.infer<typeof createDocsSignalResultSchema>> {
  const parsed = createDocsSignalInputSchema.parse(input);
  const dedupeKey = buildDedupeKey(parsed.source);

  return withDocsAgentDatabase(async (db) => {
    if (dedupeKey !== null) {
      const existing = await findSignalByDedupeKey(db, dedupeKey);
      if (existing !== null) {
        return createDocsSignalResultSchema.parse({
          created: false,
          signal: await readDocsSignalDetail(db, existing.id),
        });
      }
    }

    const signalId = randomUUID();
    const capturedAt = parsed.source.capturedAt ?? nowIso();
    const createdAt = nowIso();

    await db.insert(docsSignals).values({
      id: signalId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      status: "captured",
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

    await insertSource(db, signalId, parsed.source, capturedAt);
    await insertLinks(db, signalId, parsed.links);
    await insertArtifacts(db, signalId, parsed.artifacts);
    await insertEvent(db, {
      signalId,
      eventType: "signal-created",
      fromStatus: null,
      toStatus: "captured",
      reason: "Docs signal captured.",
      actor: "docs-agent",
      metadata: { dedupeKey },
    });

    return createDocsSignalResultSchema.parse({
      created: true,
      signal: await readDocsSignalDetail(db, signalId),
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
      .orderBy(desc(docsSignals.updatedAt))
      .limit(parsed.limit);

    return listDocsSignalsResultSchema.parse({
      signals: rows.map(parseSignalRow),
    });
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
    });

    return readDocsSignalDetail(db, parsed.id);
  });
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

  const [sources, links, artifacts, events] = await Promise.all([
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
  ]);

  return docsSignalDetailSchema.parse({
    ...signal,
    sources: sources.map(parseSourceRow),
    links: links.map(parseLinkRow),
    artifacts: artifacts.map(parseArtifactRow),
    events: events.map(parseEventRow),
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
