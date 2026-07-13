import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import { docsFollowUpRuns, docsFollowUps, docsSignalEvents, docsSignals } from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";

export const DOCS_FOLLOW_UP_SCHEDULE_ID = "daily-docs-follow-ups";
export const DOCS_FOLLOW_UP_TIME_ZONE = "UTC";
export const DOCS_FOLLOW_UP_MAX_PER_RUN = 20;

export const docsFollowUpStatusSchema = z.enum(["pending", "completed", "cancelled"]);
export const docsFollowUpSchema = z.object({ id: z.string(), signalId: z.string(), reason: z.string(), dueAt: z.string(), status: docsFollowUpStatusSchema, processedOccurrence: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() });
export const docsFollowUpRunSchema = z.object({ id: z.string(), scheduleId: z.string(), occurrenceKey: z.string(), timeZone: z.string(), status: z.enum(["running", "completed", "failed"]), dueCount: z.number().int(), processedCount: z.number().int(), error: z.string().nullable(), startedAt: z.string(), completedAt: z.string().nullable() });
export const createDocsFollowUpInputSchema = z.object({ signalId: z.string().trim().min(1), reason: z.string().trim().min(1).max(1_000), dueAt: z.string().datetime() });

export async function createDocsFollowUp(input: z.infer<typeof createDocsFollowUpInputSchema>) {
  const parsed = createDocsFollowUpInputSchema.parse(input);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const signals = await tx.select({ id: docsSignals.id, nextActionAt: docsSignals.nextActionAt }).from(docsSignals).where(and(eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsSignals.id, parsed.signalId))).limit(1);
    if (signals.length !== 1) throw new Error(`Docs signal not found: ${parsed.signalId}`);
    const now = new Date().toISOString();
    const id = randomUUID();
    await tx.insert(docsFollowUps).values({ id, workspaceId: DEFAULT_WORKSPACE_ID, signalId: parsed.signalId, reason: parsed.reason, dueAt: parsed.dueAt, status: "pending", processedOccurrence: null, createdAt: now, updatedAt: now });
    const nextActionAt = signals[0]!.nextActionAt === null || parsed.dueAt < signals[0]!.nextActionAt ? parsed.dueAt : signals[0]!.nextActionAt;
    await tx.update(docsSignals).set({ nextActionAt, updatedAt: now }).where(eq(docsSignals.id, parsed.signalId));
    return docsFollowUpSchema.parse({ id, signalId: parsed.signalId, reason: parsed.reason, dueAt: parsed.dueAt, status: "pending", processedOccurrence: null, createdAt: now, updatedAt: now });
  }));
}

export async function listDocsFollowUps(input: { status?: z.infer<typeof docsFollowUpStatusSchema>; limit?: number } = {}) {
  const limit = z.number().int().min(1).max(100).default(50).parse(input.limit);
  return withDocsAgentDatabase(async (db) => {
    const condition = input.status === undefined ? eq(docsFollowUps.workspaceId, DEFAULT_WORKSPACE_ID) : and(eq(docsFollowUps.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUps.status, docsFollowUpStatusSchema.parse(input.status)));
    const rows = await db.select().from(docsFollowUps).where(condition).orderBy(asc(docsFollowUps.dueAt)).limit(limit);
    return rows.map((row) => docsFollowUpSchema.parse(row));
  });
}

export async function cancelDocsFollowUp(input: { id: string; reason: string }) {
  const id = z.string().trim().min(1).parse(input.id);
  const reason = z.string().trim().min(1).max(1_000).parse(input.reason);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const rows = await tx.select().from(docsFollowUps).where(and(eq(docsFollowUps.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUps.id, id))).limit(1);
    const current = rows[0];
    if (current === undefined) throw new Error(`Docs follow-up not found: ${id}`);
    if (current.status !== "pending") throw new Error(`Docs follow-up ${id} is already ${current.status}.`);
    const now = new Date().toISOString();
    await tx.update(docsFollowUps).set({ status: "cancelled", updatedAt: now }).where(and(eq(docsFollowUps.id, id), eq(docsFollowUps.status, "pending")));
    const nextRows = await tx.select({ dueAt: docsFollowUps.dueAt }).from(docsFollowUps).where(and(eq(docsFollowUps.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUps.signalId, current.signalId), eq(docsFollowUps.status, "pending"))).orderBy(asc(docsFollowUps.dueAt)).limit(1);
    await tx.update(docsSignals).set({ nextActionAt: nextRows[0]?.dueAt ?? null, updatedAt: now }).where(eq(docsSignals.id, current.signalId));
    await tx.insert(docsSignalEvents).values({ id: randomUUID(), signalId: current.signalId, workspaceId: DEFAULT_WORKSPACE_ID, eventType: "follow-up-cancelled", fromStatus: null, toStatus: null, reason, actor: "docs-agent:follow-up", metadata: { followUpId: id }, createdAt: now });
    return docsFollowUpSchema.parse({ ...current, status: "cancelled", updatedAt: now });
  }));
}

export async function processDueDocsFollowUps(options: { now?: Date; beforeProcess?: () => Promise<void> } = {}) {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const occurrenceKey = startedAt.slice(0, 10);
  const runId = `follow-up-run:${DOCS_FOLLOW_UP_SCHEDULE_ID}:${occurrenceKey}`;
  const existing = await withDocsAgentDatabase(async (db) => {
    const rows = await db.select().from(docsFollowUpRuns).where(and(eq(docsFollowUpRuns.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUpRuns.scheduleId, DOCS_FOLLOW_UP_SCHEDULE_ID), eq(docsFollowUpRuns.occurrenceKey, occurrenceKey))).limit(1);
    if (rows[0] !== undefined) return docsFollowUpRunSchema.parse(rows[0]);
    const inserted = await db.insert(docsFollowUpRuns).values({ id: runId, workspaceId: DEFAULT_WORKSPACE_ID, scheduleId: DOCS_FOLLOW_UP_SCHEDULE_ID, occurrenceKey, timeZone: DOCS_FOLLOW_UP_TIME_ZONE, status: "running", dueCount: 0, processedCount: 0, error: null, startedAt, completedAt: null }).onConflictDoNothing({ target: [docsFollowUpRuns.workspaceId, docsFollowUpRuns.scheduleId, docsFollowUpRuns.occurrenceKey] }).returning({ id: docsFollowUpRuns.id });
    if (inserted.length === 1) return null;
    const concurrent = await db.select().from(docsFollowUpRuns).where(and(eq(docsFollowUpRuns.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUpRuns.scheduleId, DOCS_FOLLOW_UP_SCHEDULE_ID), eq(docsFollowUpRuns.occurrenceKey, occurrenceKey))).limit(1);
    return docsFollowUpRunSchema.parse(concurrent[0]);
  });
  if (existing !== null && existing.status !== "running") return { replayed: true, run: existing, due: [] as Array<{ followUpId: string; signalId: string; reason: string }> };

  try {
    await options.beforeProcess?.();
    const due = await withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
      const rows = await tx.select().from(docsFollowUps).where(and(eq(docsFollowUps.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUps.status, "pending"), lte(docsFollowUps.dueAt, startedAt))).orderBy(asc(docsFollowUps.dueAt)).limit(DOCS_FOLLOW_UP_MAX_PER_RUN);
      const processed = [];
      for (const row of rows) {
        const updated = await tx.update(docsFollowUps).set({ status: "completed", processedOccurrence: occurrenceKey, updatedAt: startedAt }).where(and(eq(docsFollowUps.id, row.id), eq(docsFollowUps.status, "pending"))).returning({ id: docsFollowUps.id });
        if (updated.length !== 1) continue;
        const nextRows = await tx.select({ dueAt: docsFollowUps.dueAt }).from(docsFollowUps).where(and(eq(docsFollowUps.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsFollowUps.signalId, row.signalId), eq(docsFollowUps.status, "pending"))).orderBy(asc(docsFollowUps.dueAt)).limit(1);
        await tx.update(docsSignals).set({ nextActionAt: nextRows[0]?.dueAt ?? null, updatedAt: startedAt }).where(eq(docsSignals.id, row.signalId));
        await tx.insert(docsSignalEvents).values({ id: randomUUID(), signalId: row.signalId, workspaceId: DEFAULT_WORKSPACE_ID, eventType: "scheduled-follow-up-due", fromStatus: null, toStatus: null, reason: row.reason, actor: "docs-agent:daily-follow-up", metadata: { followUpId: row.id, occurrenceKey, scheduleId: DOCS_FOLLOW_UP_SCHEDULE_ID }, createdAt: startedAt });
        processed.push({ followUpId: row.id, signalId: row.signalId, reason: row.reason });
      }
      await tx.update(docsFollowUpRuns).set({ status: "completed", dueCount: rows.length, processedCount: processed.length, completedAt: startedAt }).where(eq(docsFollowUpRuns.id, runId));
      return processed;
    }));
    return { replayed: false, run: await getLatestDocsFollowUpRun(), due };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withDocsAgentDatabase(async (db) => { await db.update(docsFollowUpRuns).set({ status: "failed", error: message.slice(0, 2_000), completedAt: new Date().toISOString() }).where(eq(docsFollowUpRuns.id, runId)); });
    throw new Error(`Scheduled docs follow-up run failed and was recorded: ${message}`);
  }
}

export async function getLatestDocsFollowUpRun() {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.select().from(docsFollowUpRuns).where(eq(docsFollowUpRuns.workspaceId, DEFAULT_WORKSPACE_ID)).orderBy(desc(docsFollowUpRuns.startedAt)).limit(1);
    return rows[0] === undefined ? null : docsFollowUpRunSchema.parse(rows[0]);
  });
}
