import { randomUUID } from "node:crypto";

import { and, asc, eq, lte, ne } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase, type DocsAgentDatabase } from "./db/client.ts";
import {
  internalDocumentAttachments,
  internalDocumentRevisions,
  internalDocuments,
  policyBoundWatches,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";

export const INTERNAL_DOCUMENT_MAX_CONTENT_BYTES = 64 * 1024;
export const INTERNAL_DOCUMENT_MAX_REVISIONS = 100;
export const INTERNAL_DOCUMENT_MAX_ATTACHMENTS = 20;
export const INTERNAL_DOCUMENT_MAX_RETENTION_DAYS = 365;

const identifierSchema = z.string().trim().min(1).max(200);
const slugSchema = z.string().trim().regex(/^[a-z][a-z0-9-]*$/).max(64);
const operationKeySchema = z.string().trim().min(1).max(500);
const summarySchema = z.string().trim().min(1).max(500);
const isoSchema = z.string().datetime({ offset: true });

export const internalDocumentLifecycleSchema = z.enum([
  "active",
  "archived",
  "expired",
]);

export const internalDocumentSourceReferenceSchema = z.object({
  kind: slugSchema,
  id: identifierSchema,
  url: z.string().url().max(2_000).optional(),
}).strict();

export const internalDocumentSourceReferencesSchema = z
  .array(internalDocumentSourceReferenceSchema)
  .max(20);

export const internalDocumentAttachmentTargetSchema = z.object({
  resourceType: z.literal("policy-bound-watch"),
  resourceId: z.string().uuid(),
  relationship: z.literal("continuity"),
}).strict();

export const internalDocumentActorSchema = z.object({
  type: z.enum(["agent", "operator", "system"]),
  id: identifierSchema,
}).strict();

export const internalDocumentCommandContextSchema = z.object({
  authority: z.literal("docs_work.manage"),
  actor: internalDocumentActorSchema,
  sessionId: identifierSchema,
  runId: identifierSchema,
  operationKey: operationKeySchema,
  now: z.date().optional(),
}).strict();

export type InternalDocumentCommandContext = z.infer<
  typeof internalDocumentCommandContextSchema
>;

const contentSchema = z.string().max(INTERNAL_DOCUMENT_MAX_CONTENT_BYTES);

export const createInternalDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: slugSchema.default("working-notes"),
  editingProfile: slugSchema.default("living-summary"),
  content: contentSchema,
  retentionDays: z.number().int().min(1).max(INTERNAL_DOCUMENT_MAX_RETENTION_DAYS).default(90),
  attachment: internalDocumentAttachmentTargetSchema.optional(),
  sourceReferences: internalDocumentSourceReferencesSchema.default([]),
}).strict();

export const readInternalDocumentInputSchema = z.object({
  documentId: z.string().uuid(),
  revision: z.number().int().positive().max(INTERNAL_DOCUMENT_MAX_REVISIONS).optional(),
}).strict();

export const updateInternalDocumentInputSchema = z.object({
  documentId: z.string().uuid(),
  expectedRevision: z.number().int().positive().max(INTERNAL_DOCUMENT_MAX_REVISIONS),
  content: contentSchema,
  changeSummary: summarySchema,
  sourceReferences: internalDocumentSourceReferencesSchema.default([]),
}).strict();

export const findInternalDocumentByAttachmentInputSchema = z.object({
  attachment: internalDocumentAttachmentTargetSchema,
}).strict();

export const attachInternalDocumentInputSchema = z.object({
  documentId: z.string().uuid(),
  expectedRevision: z.number().int().positive().max(INTERNAL_DOCUMENT_MAX_REVISIONS),
  attachment: internalDocumentAttachmentTargetSchema,
}).strict();

export const archiveInternalDocumentInputSchema = z.object({
  documentId: z.string().uuid(),
  expectedRevision: z.number().int().positive().max(INTERNAL_DOCUMENT_MAX_REVISIONS),
  reason: summarySchema,
  sourceReferences: internalDocumentSourceReferencesSchema.default([]),
}).strict();

export const internalDocumentAttachmentSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  target: internalDocumentAttachmentTargetSchema,
  actor: internalDocumentActorSchema,
  sessionId: identifierSchema,
  runId: identifierSchema,
  createdAt: isoSchema,
}).strict();

export const internalDocumentRevisionSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  action: z.enum(["create", "update", "archive"]),
  summary: summarySchema,
  actor: internalDocumentActorSchema,
  sessionId: identifierSchema,
  runId: identifierSchema,
  sourceReferences: internalDocumentSourceReferencesSchema,
  createdAt: isoSchema,
}).strict();

export const internalDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  kind: slugSchema,
  editingProfile: slugSchema,
  lifecycleState: internalDocumentLifecycleSchema,
  currentRevision: z.number().int().positive(),
  selectedRevision: z.number().int().positive().nullable(),
  content: z.string().nullable(),
  retentionExpiresAt: isoSchema,
  archivedAt: isoSchema.nullable(),
  expiredAt: isoSchema.nullable(),
  createdAt: isoSchema,
  updatedAt: isoSchema,
  attachments: z.array(internalDocumentAttachmentSchema).max(INTERNAL_DOCUMENT_MAX_ATTACHMENTS),
  revisions: z.array(internalDocumentRevisionSchema).max(INTERNAL_DOCUMENT_MAX_REVISIONS),
}).strict();

export const internalDocumentMutationResultSchema = z.object({
  created: z.boolean(),
  replayed: z.boolean(),
  document: internalDocumentSchema,
}).strict();

export type InternalDocument = z.infer<typeof internalDocumentSchema>;
export type InternalDocumentAttachmentTarget = z.infer<
  typeof internalDocumentAttachmentTargetSchema
>;

type Executor = Pick<DocsAgentDatabase, "select" | "insert" | "update" | "delete">;

export class InternalDocumentError extends Error {
  readonly code:
    | "unauthorized"
    | "not-found"
    | "attachment-target-not-found"
    | "attachment-conflict"
    | "concurrent-update"
    | "lifecycle"
    | "content-bound"
    | "revision-bound"
    | "attachment-bound";

  constructor(code: InternalDocumentError["code"], message: string) {
    super(message);
    this.name = "InternalDocumentError";
    this.code = code;
  }
}

export async function createInternalDocument(
  input: z.input<typeof createInternalDocumentInputSchema>,
  context: unknown,
): Promise<z.infer<typeof internalDocumentMutationResultSchema>> {
  const parsed = createInternalDocumentInputSchema.parse(input);
  const command = requireCommandContext(context);
  assertContentBound(parsed.content);
  const now = commandNow(command);

  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await expireRetainedDocuments(tx, now);

    const replay = await findByCreationOperation(tx, command.operationKey);
    if (replay !== null) {
      return internalDocumentMutationResultSchema.parse({
        created: false,
        replayed: true,
        document: await readDocument(tx, replay.id),
      });
    }

    if (parsed.attachment !== undefined) {
      await requireAttachmentTarget(tx, parsed.attachment);
      const attached = await findAttachment(tx, parsed.attachment);
      if (attached !== null) {
        return internalDocumentMutationResultSchema.parse({
          created: false,
          replayed: false,
          document: await readDocument(tx, attached.documentId),
        });
      }
    }

    const documentId = randomUUID();
    const createdAt = now.toISOString();
    const retentionExpiresAt = new Date(
      now.getTime() + parsed.retentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();

    await tx.insert(internalDocuments).values({
      id: documentId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: parsed.title,
      kind: parsed.kind,
      editingProfile: parsed.editingProfile,
      lifecycleState: "active",
      currentRevision: 1,
      creationOperationKey: command.operationKey,
      retentionExpiresAt,
      archivedAt: null,
      expiredAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    await insertRevision(tx, {
      documentId,
      revision: 1,
      action: "create",
      summary: "Internal working document created.",
      content: parsed.content,
      sourceReferences: parsed.sourceReferences,
      command,
      createdAt,
    });

    if (parsed.attachment !== undefined) {
      const inserted = await insertAttachment(
        tx,
        documentId,
        parsed.attachment,
        command,
        createdAt,
      );
      if (!inserted) {
        await tx.delete(internalDocumentRevisions).where(and(
          eq(internalDocumentRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(internalDocumentRevisions.documentId, documentId),
        ));
        await tx.delete(internalDocuments).where(and(
          eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(internalDocuments.id, documentId),
        ));
        const concurrent = await requireAttachment(tx, parsed.attachment);
        return internalDocumentMutationResultSchema.parse({
          created: false,
          replayed: false,
          document: await readDocument(tx, concurrent.documentId),
        });
      }
    }

    return internalDocumentMutationResultSchema.parse({
      created: true,
      replayed: false,
      document: await readDocument(tx, documentId),
    });
  }));
}

export async function readInternalDocument(
  input: z.input<typeof readInternalDocumentInputSchema>,
  context: unknown,
): Promise<InternalDocument> {
  const parsed = readInternalDocumentInputSchema.parse(input);
  const command = requireCommandContext(context);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await expireRetainedDocuments(tx, commandNow(command));
    return readDocument(tx, parsed.documentId, parsed.revision);
  }));
}

export async function updateInternalDocument(
  input: z.input<typeof updateInternalDocumentInputSchema>,
  context: unknown,
): Promise<z.infer<typeof internalDocumentMutationResultSchema>> {
  const parsed = updateInternalDocumentInputSchema.parse(input);
  const command = requireCommandContext(context);
  assertContentBound(parsed.content);
  const now = commandNow(command);

  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await expireRetainedDocuments(tx, now);
    const current = await requireMutableDocument(tx, parsed.documentId);
    const replay = await findRevisionByOperation(tx, parsed.documentId, command.operationKey);
    if (replay !== null) {
      return internalDocumentMutationResultSchema.parse({
        created: false,
        replayed: true,
        document: await readDocument(tx, parsed.documentId),
      });
    }
    assertExpectedRevision(current.currentRevision, parsed.expectedRevision, parsed.documentId);
    assertRevisionCapacity(current.currentRevision);

    const nextRevision = current.currentRevision + 1;
    const updatedAt = now.toISOString();
    await insertRevision(tx, {
      documentId: parsed.documentId,
      revision: nextRevision,
      action: "update",
      summary: parsed.changeSummary,
      content: parsed.content,
      sourceReferences: parsed.sourceReferences,
      command,
      createdAt: updatedAt,
    });
    const updated = await tx.update(internalDocuments).set({
      currentRevision: nextRevision,
      updatedAt,
    }).where(and(
      eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocuments.id, parsed.documentId),
      eq(internalDocuments.lifecycleState, "active"),
      eq(internalDocuments.currentRevision, parsed.expectedRevision),
    )).returning({ id: internalDocuments.id });
    if (updated.length !== 1) {
      throw concurrentUpdate(parsed.documentId, parsed.expectedRevision);
    }
    return internalDocumentMutationResultSchema.parse({
      created: false,
      replayed: false,
      document: await readDocument(tx, parsed.documentId),
    });
  }));
}

export async function findInternalDocumentByAttachment(
  input: z.input<typeof findInternalDocumentByAttachmentInputSchema>,
  context: unknown,
): Promise<InternalDocument | null> {
  const parsed = findInternalDocumentByAttachmentInputSchema.parse(input);
  const command = requireCommandContext(context);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await expireRetainedDocuments(tx, commandNow(command));
    await requireAttachmentTarget(tx, parsed.attachment);
    const attachment = await findAttachment(tx, parsed.attachment);
    return attachment === null ? null : readDocument(tx, attachment.documentId);
  }));
}

export async function attachInternalDocument(
  input: z.input<typeof attachInternalDocumentInputSchema>,
  context: unknown,
): Promise<z.infer<typeof internalDocumentMutationResultSchema>> {
  const parsed = attachInternalDocumentInputSchema.parse(input);
  const command = requireCommandContext(context);
  const now = commandNow(command);

  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await expireRetainedDocuments(tx, now);
    const current = await requireMutableDocument(tx, parsed.documentId);
    assertExpectedRevision(current.currentRevision, parsed.expectedRevision, parsed.documentId);
    await requireAttachmentTarget(tx, parsed.attachment);

    const operationReplay = await findAttachmentByOperation(tx, command.operationKey);
    if (operationReplay !== null) {
      if (operationReplay.documentId !== parsed.documentId) {
        throw attachmentConflict(parsed.attachment);
      }
      return internalDocumentMutationResultSchema.parse({
        created: false,
        replayed: true,
        document: await readDocument(tx, parsed.documentId),
      });
    }
    const existing = await findAttachment(tx, parsed.attachment);
    if (existing !== null) {
      if (existing.documentId !== parsed.documentId) {
        throw attachmentConflict(parsed.attachment);
      }
      return internalDocumentMutationResultSchema.parse({
        created: false,
        replayed: true,
        document: await readDocument(tx, parsed.documentId),
      });
    }
    const attachmentCount = await countAttachments(tx, parsed.documentId);
    if (attachmentCount >= INTERNAL_DOCUMENT_MAX_ATTACHMENTS) {
      throw new InternalDocumentError(
        "attachment-bound",
        `Internal document ${parsed.documentId} cannot exceed ${INTERNAL_DOCUMENT_MAX_ATTACHMENTS} attachments.`,
      );
    }
    const inserted = await insertAttachment(
      tx,
      parsed.documentId,
      parsed.attachment,
      command,
      now.toISOString(),
    );
    if (!inserted) {
      const concurrent = await requireAttachment(tx, parsed.attachment);
      if (concurrent.documentId !== parsed.documentId) {
        throw attachmentConflict(parsed.attachment);
      }
    }
    return internalDocumentMutationResultSchema.parse({
      created: false,
      replayed: !inserted,
      document: await readDocument(tx, parsed.documentId),
    });
  }));
}

export async function archiveInternalDocument(
  input: z.input<typeof archiveInternalDocumentInputSchema>,
  context: unknown,
): Promise<z.infer<typeof internalDocumentMutationResultSchema>> {
  const parsed = archiveInternalDocumentInputSchema.parse(input);
  const command = requireCommandContext(context);
  const now = commandNow(command);

  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    await expireRetainedDocuments(tx, now);
    const current = await requireDocumentRow(tx, parsed.documentId);
    const replay = await findRevisionByOperation(tx, parsed.documentId, command.operationKey);
    if (replay !== null) {
      return internalDocumentMutationResultSchema.parse({
        created: false,
        replayed: true,
        document: await readDocument(tx, parsed.documentId),
      });
    }
    if (current.lifecycleState !== "active") {
      throw lifecycleError(parsed.documentId, current.lifecycleState);
    }
    assertExpectedRevision(current.currentRevision, parsed.expectedRevision, parsed.documentId);
    assertRevisionCapacity(current.currentRevision);
    const content = await requireRevisionContent(tx, parsed.documentId, current.currentRevision);
    const nextRevision = current.currentRevision + 1;
    const archivedAt = now.toISOString();
    await insertRevision(tx, {
      documentId: parsed.documentId,
      revision: nextRevision,
      action: "archive",
      summary: parsed.reason,
      content,
      sourceReferences: parsed.sourceReferences,
      command,
      createdAt: archivedAt,
    });
    const updated = await tx.update(internalDocuments).set({
      lifecycleState: "archived",
      currentRevision: nextRevision,
      archivedAt,
      updatedAt: archivedAt,
    }).where(and(
      eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocuments.id, parsed.documentId),
      eq(internalDocuments.lifecycleState, "active"),
      eq(internalDocuments.currentRevision, parsed.expectedRevision),
    )).returning({ id: internalDocuments.id });
    if (updated.length !== 1) {
      throw concurrentUpdate(parsed.documentId, parsed.expectedRevision);
    }
    return internalDocumentMutationResultSchema.parse({
      created: false,
      replayed: false,
      document: await readDocument(tx, parsed.documentId),
    });
  }));
}

export async function expireInternalDocuments(now = new Date()): Promise<number> {
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) =>
    expireRetainedDocuments(tx, now)
  ));
}

function requireCommandContext(context: unknown): InternalDocumentCommandContext {
  const parsed = internalDocumentCommandContextSchema.safeParse(context);
  if (!parsed.success) {
    throw new InternalDocumentError(
      "unauthorized",
      "Internal document operations require server-owned docs_work.manage authority and runtime provenance.",
    );
  }
  return parsed.data;
}

function commandNow(context: InternalDocumentCommandContext): Date {
  return context.now ?? new Date();
}

function assertContentBound(content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > INTERNAL_DOCUMENT_MAX_CONTENT_BYTES) {
    throw new InternalDocumentError(
      "content-bound",
      `Internal document content is ${bytes} bytes; the limit is ${INTERNAL_DOCUMENT_MAX_CONTENT_BYTES} bytes.`,
    );
  }
}

async function expireRetainedDocuments(db: Executor, now: Date): Promise<number> {
  const expiredAt = now.toISOString();
  const rows = await db.select({ id: internalDocuments.id }).from(internalDocuments).where(and(
    eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
    ne(internalDocuments.lifecycleState, "expired"),
    lte(internalDocuments.retentionExpiresAt, expiredAt),
  ));
  for (const row of rows) {
    await db.delete(internalDocumentAttachments).where(and(
      eq(internalDocumentAttachments.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocumentAttachments.documentId, row.id),
    ));
    await db.delete(internalDocumentRevisions).where(and(
      eq(internalDocumentRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocumentRevisions.documentId, row.id),
    ));
    await db.update(internalDocuments).set({
      lifecycleState: "expired",
      expiredAt,
      updatedAt: expiredAt,
    }).where(and(
      eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocuments.id, row.id),
      ne(internalDocuments.lifecycleState, "expired"),
    ));
  }
  return rows.length;
}

async function readDocument(
  db: Executor,
  documentId: string,
  selectedRevision?: number,
): Promise<InternalDocument> {
  const document = await requireDocumentRow(db, documentId);
  const revisionRows = await db.select().from(internalDocumentRevisions).where(and(
    eq(internalDocumentRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(internalDocumentRevisions.documentId, documentId),
  )).orderBy(asc(internalDocumentRevisions.revision));
  const attachmentRows = await db.select().from(internalDocumentAttachments).where(and(
    eq(internalDocumentAttachments.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(internalDocumentAttachments.documentId, documentId),
  )).orderBy(asc(internalDocumentAttachments.createdAt));

  const requestedRevision = selectedRevision ?? document.currentRevision;
  const selected = revisionRows.find(({ revision }) => revision === requestedRevision);
  if (document.lifecycleState !== "expired" && selected === undefined) {
    throw new InternalDocumentError(
      "not-found",
      `Internal document ${documentId} revision ${requestedRevision} was not found.`,
    );
  }

  return internalDocumentSchema.parse({
    id: document.id,
    title: document.title,
    kind: document.kind,
    editingProfile: document.editingProfile,
    lifecycleState: document.lifecycleState,
    currentRevision: document.currentRevision,
    selectedRevision: selected?.revision ?? null,
    content: selected?.content ?? null,
    retentionExpiresAt: document.retentionExpiresAt,
    archivedAt: document.archivedAt,
    expiredAt: document.expiredAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    attachments: attachmentRows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      target: {
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        relationship: row.relationship,
      },
      actor: { type: row.actorType, id: row.actorId },
      sessionId: row.sessionId,
      runId: row.runId,
      createdAt: row.createdAt,
    })),
    revisions: revisionRows.map((row) => ({
      id: row.id,
      revision: row.revision,
      action: row.action,
      summary: row.summary,
      actor: { type: row.actorType, id: row.actorId },
      sessionId: row.sessionId,
      runId: row.runId,
      sourceReferences: row.sourceReferences,
      createdAt: row.createdAt,
    })),
  });
}

async function requireDocumentRow(db: Executor, documentId: string) {
  const rows = await db.select().from(internalDocuments).where(and(
    eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(internalDocuments.id, documentId),
  )).limit(1);
  const document = rows[0];
  if (document === undefined) {
    throw new InternalDocumentError(
      "not-found",
      `Internal document ${documentId} was not found in the current workspace.`,
    );
  }
  return document;
}

async function requireMutableDocument(db: Executor, documentId: string) {
  const document = await requireDocumentRow(db, documentId);
  if (document.lifecycleState !== "active") {
    throw lifecycleError(documentId, document.lifecycleState);
  }
  return document;
}

async function requireRevisionContent(
  db: Executor,
  documentId: string,
  revision: number,
): Promise<string> {
  const rows = await db.select({ content: internalDocumentRevisions.content })
    .from(internalDocumentRevisions)
    .where(and(
      eq(internalDocumentRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocumentRevisions.documentId, documentId),
      eq(internalDocumentRevisions.revision, revision),
    )).limit(1);
  const content = rows[0]?.content;
  if (content === undefined) {
    throw new InternalDocumentError(
      "not-found",
      `Internal document ${documentId} revision ${revision} content was not found.`,
    );
  }
  return content;
}

async function findByCreationOperation(db: Executor, operationKey: string) {
  const rows = await db.select({ id: internalDocuments.id }).from(internalDocuments).where(and(
    eq(internalDocuments.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(internalDocuments.creationOperationKey, operationKey),
  )).limit(1);
  return rows[0] ?? null;
}

async function findRevisionByOperation(
  db: Executor,
  documentId: string,
  operationKey: string,
) {
  const rows = await db.select({ id: internalDocumentRevisions.id })
    .from(internalDocumentRevisions)
    .where(and(
      eq(internalDocumentRevisions.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocumentRevisions.documentId, documentId),
      eq(internalDocumentRevisions.operationKey, operationKey),
    )).limit(1);
  return rows[0] ?? null;
}

async function insertRevision(
  db: Executor,
  input: {
    documentId: string;
    revision: number;
    action: "create" | "update" | "archive";
    summary: string;
    content: string;
    sourceReferences: z.infer<typeof internalDocumentSourceReferencesSchema>;
    command: InternalDocumentCommandContext;
    createdAt: string;
  },
): Promise<void> {
  await db.insert(internalDocumentRevisions).values({
    id: randomUUID(),
    documentId: input.documentId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    revision: input.revision,
    operationKey: input.command.operationKey,
    action: input.action,
    summary: input.summary,
    content: input.content,
    actorType: input.command.actor.type,
    actorId: input.command.actor.id,
    sessionId: input.command.sessionId,
    runId: input.command.runId,
    sourceReferences: input.sourceReferences,
    createdAt: input.createdAt,
  });
}

async function requireAttachmentTarget(
  db: Executor,
  target: InternalDocumentAttachmentTarget,
): Promise<void> {
  const rows = await db.select({ id: policyBoundWatches.id })
    .from(policyBoundWatches)
    .where(and(
      eq(policyBoundWatches.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(policyBoundWatches.id, target.resourceId),
      ne(policyBoundWatches.lifecycleState, "deleted"),
    )).limit(1);
  if (rows.length !== 1) {
    throw new InternalDocumentError(
      "attachment-target-not-found",
      `Authorized ${target.resourceType}/${target.relationship} target ${target.resourceId} was not found in the current workspace.`,
    );
  }
}

async function insertAttachment(
  db: Executor,
  documentId: string,
  target: InternalDocumentAttachmentTarget,
  command: InternalDocumentCommandContext,
  createdAt: string,
): Promise<boolean> {
  const rows = await db.insert(internalDocumentAttachments).values({
    id: randomUUID(),
    documentId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    resourceType: target.resourceType,
    resourceId: target.resourceId,
    relationship: target.relationship,
    operationKey: command.operationKey,
    actorType: command.actor.type,
    actorId: command.actor.id,
    sessionId: command.sessionId,
    runId: command.runId,
    createdAt,
  }).onConflictDoNothing().returning({ id: internalDocumentAttachments.id });
  return rows.length === 1;
}

async function findAttachment(
  db: Executor,
  target: InternalDocumentAttachmentTarget,
) {
  const rows = await db.select({
    id: internalDocumentAttachments.id,
    documentId: internalDocumentAttachments.documentId,
  }).from(internalDocumentAttachments).where(and(
    eq(internalDocumentAttachments.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(internalDocumentAttachments.resourceType, target.resourceType),
    eq(internalDocumentAttachments.resourceId, target.resourceId),
    eq(internalDocumentAttachments.relationship, target.relationship),
  )).limit(1);
  return rows[0] ?? null;
}

async function requireAttachment(
  db: Executor,
  target: InternalDocumentAttachmentTarget,
) {
  const attachment = await findAttachment(db, target);
  if (attachment === null) {
    throw new InternalDocumentError(
      "attachment-conflict",
      `Concurrent ${target.resourceType}/${target.relationship} attachment could not be resolved.`,
    );
  }
  return attachment;
}

async function findAttachmentByOperation(db: Executor, operationKey: string) {
  const rows = await db.select({
    id: internalDocumentAttachments.id,
    documentId: internalDocumentAttachments.documentId,
  }).from(internalDocumentAttachments).where(and(
    eq(internalDocumentAttachments.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(internalDocumentAttachments.operationKey, operationKey),
  )).limit(1);
  return rows[0] ?? null;
}

async function countAttachments(db: Executor, documentId: string): Promise<number> {
  const rows = await db.select({ id: internalDocumentAttachments.id })
    .from(internalDocumentAttachments)
    .where(and(
      eq(internalDocumentAttachments.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(internalDocumentAttachments.documentId, documentId),
    )).limit(INTERNAL_DOCUMENT_MAX_ATTACHMENTS + 1);
  return rows.length;
}

function assertExpectedRevision(
  actualRevision: number,
  expectedRevision: number,
  documentId: string,
): void {
  if (actualRevision !== expectedRevision) {
    throw concurrentUpdate(documentId, expectedRevision, actualRevision);
  }
}

function assertRevisionCapacity(currentRevision: number): void {
  if (currentRevision >= INTERNAL_DOCUMENT_MAX_REVISIONS) {
    throw new InternalDocumentError(
      "revision-bound",
      `Internal documents cannot exceed ${INTERNAL_DOCUMENT_MAX_REVISIONS} revisions. Archive or replace the document instead.`,
    );
  }
}

function concurrentUpdate(
  documentId: string,
  expectedRevision: number,
  actualRevision?: number,
): InternalDocumentError {
  const actual = actualRevision === undefined ? "another revision" : String(actualRevision);
  return new InternalDocumentError(
    "concurrent-update",
    `Internal document ${documentId} changed concurrently. Expected revision ${expectedRevision}, found ${actual}. Read the current document before retrying.`,
  );
}

function lifecycleError(documentId: string, lifecycleState: string): InternalDocumentError {
  return new InternalDocumentError(
    "lifecycle",
    `Internal document ${documentId} is ${lifecycleState} and cannot be changed.`,
  );
}

function attachmentConflict(target: InternalDocumentAttachmentTarget): InternalDocumentError {
  return new InternalDocumentError(
    "attachment-conflict",
    `${target.resourceType}/${target.resourceId}/${target.relationship} already belongs to another internal document.`,
  );
}
