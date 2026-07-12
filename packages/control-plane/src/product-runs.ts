import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase, type DocsAgentDatabase } from "./db/client.js";
import {
  docsSignals,
  productRunSteps,
  productRunTraceLinks,
  productRuns,
} from "./db/schema.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";

const RETENTION_DAYS = 30;
const isoSchema = z.string().datetime({ offset: true });
const nonEmpty = z.string().trim().min(1);

export const productRunTypeSchema = z.enum([
  "signal-capture",
  "docs-verification",
  "patch-preparation",
  "writeback",
  "owned-docs-work",
]);
export const productRunTriggerSchema = z.enum([
  "slack",
  "linear",
  "schedule",
  "terminal",
  "web",
  "other",
]);
export const productRunStatusSchema = z.enum([
  "active",
  "waiting-for-input",
  "failed",
  "completed",
]);
export const productRunDisplayStateSchema = z.enum([
  ...productRunStatusSchema.options,
  "expired",
]);
export const productRunStepStatusSchema = z.enum(["active", "failed", "completed"]);
export const productTraceKindSchema = z.enum(["eve", "vercel", "opentelemetry"]);
export const productTraceAvailabilitySchema = z.enum(["available", "unavailable"]);

export const productRunTraceInputSchema = z.object({
  kind: productTraceKindSchema,
  label: nonEmpty.max(120),
  url: z.string().url().optional(),
  availability: productTraceAvailabilitySchema,
  unavailableReason: nonEmpty.max(300).optional(),
}).superRefine((value, ctx) => {
  if (value.availability === "available" && value.url === undefined) {
    ctx.addIssue({ code: "custom", path: ["url"], message: "Available traces require a URL." });
  }
  if (value.availability === "unavailable" && value.unavailableReason === undefined) {
    ctx.addIssue({ code: "custom", path: ["unavailableReason"], message: "Unavailable traces require a reason." });
  }
});

export const createProductRunInputSchema = z.object({
  operationKey: nonEmpty.max(500),
  runType: productRunTypeSchema,
  trigger: productRunTriggerSchema,
  sessionId: nonEmpty.max(500),
  runId: nonEmpty.max(500),
  signalId: nonEmpty.max(500).optional(),
  workflowId: nonEmpty.max(500).optional(),
  model: nonEmpty.max(200).optional(),
  startedAt: isoSchema.optional(),
  traceLinks: z.array(productRunTraceInputSchema).max(3).default([]),
});

export const productRunStepSchema = z.object({
  id: z.string(),
  stepKey: z.string(),
  label: z.string(),
  status: productRunStepStatusSchema,
  model: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  failureSummary: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const productRunTraceSchema = z.object({
  id: z.string(),
  kind: productTraceKindSchema,
  label: z.string(),
  url: z.string().nullable(),
  availability: productTraceAvailabilitySchema,
  unavailableReason: z.string().nullable(),
});

export const operatorProductRunListItemSchema = z.object({
  id: z.string(),
  runType: productRunTypeSchema,
  trigger: productRunTriggerSchema,
  status: productRunStatusSchema,
  displayState: productRunDisplayStateSchema,
  sessionId: z.string(),
  runId: z.string(),
  signal: z.object({ id: z.string(), summary: z.string() }).nullable(),
  workflowId: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  waitingSummary: z.string().nullable(),
  failureSummary: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string(),
  updatedAt: z.string(),
});

export const operatorProductRunDetailSchema = operatorProductRunListItemSchema.extend({
  steps: z.array(productRunStepSchema),
  traces: z.array(productRunTraceSchema),
  retentionDays: z.literal(RETENTION_DAYS),
});

export const productRunProjectionInputSchema = z.object({
  productRunId: nonEmpty,
  event: z.object({
    type: nonEmpty,
    data: z.unknown().optional(),
    timestamp: isoSchema.optional(),
  }).passthrough(),
});

export type CreateProductRunInput = z.input<typeof createProductRunInputSchema>;
export type OperatorProductRunListItem = z.infer<typeof operatorProductRunListItemSchema>;
export type OperatorProductRunDetail = z.infer<typeof operatorProductRunDetailSchema>;

export async function createProductRun(input: CreateProductRunInput) {
  const parsed = createProductRunInputSchema.parse(input);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    if (parsed.signalId !== undefined) await assertSignalExists(tx, parsed.signalId);
    const existing = await readByOperationKey(tx, parsed.operationKey);
    if (existing !== null) {
      return { created: false, run: await getProductRunDetailWith(tx, existing.id) };
    }

    const startedAt = parsed.startedAt ?? new Date().toISOString();
    const id = randomUUID();
    await tx.insert(productRuns).values({
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      operationKey: parsed.operationKey,
      runType: parsed.runType,
      trigger: parsed.trigger,
      status: "active",
      sessionId: parsed.sessionId,
      runId: parsed.runId,
      signalId: parsed.signalId ?? null,
      workflowId: parsed.workflowId ?? null,
      model: parsed.model ?? null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      waitingSummary: null,
      failureSummary: null,
      startedAt,
      completedAt: null,
      expiresAt: addDays(startedAt, RETENTION_DAYS),
      updatedAt: startedAt,
    });
    if (parsed.traceLinks.length > 0) {
      await tx.insert(productRunTraceLinks).values(parsed.traceLinks.map((trace) => ({
        id: randomUUID(),
        productRunId: id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: trace.kind,
        label: trace.label,
        url: trace.url ?? null,
        availability: trace.availability,
        unavailableReason: trace.unavailableReason ?? null,
        createdAt: startedAt,
      })));
    }
    return { created: true, run: await getProductRunDetailWith(tx, id) };
  }));
}

export async function projectProductRunEvent(input: z.infer<typeof productRunProjectionInputSchema>) {
  const parsed = productRunProjectionInputSchema.parse(input);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const current = await requireRun(tx, parsed.productRunId);
    const at = parsed.event.timestamp ?? new Date().toISOString();
    const data = record(parsed.event.data);
    const eventType = parsed.event.type;

    if (eventType === "step.started" || eventType === "step.completed" || eventType === "step.failed") {
      await projectStep(tx, current.id, eventType, data, at);
      await refreshUsageFromSteps(tx, current.id, at);
    }

    if (eventType === "turn.started" && !isTerminal(current.status)) {
      await updateStatus(tx, current.id, "active", at, null, null, null);
    } else if (eventType === "input.requested" && !isTerminal(current.status)) {
      await updateStatus(tx, current.id, "waiting-for-input", at, "Human input is required to continue.", null, null);
    } else if (eventType === "turn.completed" || eventType === "session.completed") {
      await updateStatus(tx, current.id, "completed", at, null, null, at);
    } else if (["step.failed", "turn.failed", "session.failed"].includes(eventType)) {
      await updateStatus(tx, current.id, "failed", at, null, safeFailure(data), at);
    }

    return getProductRunDetailWith(tx, current.id);
  }));
}

export async function projectProductRunEventByReference(input: {
  sessionId: string;
  runId: string;
  event: z.infer<typeof productRunProjectionInputSchema>["event"];
}) {
  const sessionId = nonEmpty.parse(input.sessionId);
  const runId = nonEmpty.parse(input.runId);
  const productRunId = await withDocsAgentDatabase(async (db) => {
    const rows = await db.select({ id: productRuns.id }).from(productRuns)
      .where(and(
        eq(productRuns.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(productRuns.sessionId, sessionId),
        eq(productRuns.runId, runId),
      ))
      .limit(1);
    return rows[0]?.id ?? null;
  });
  if (productRunId === null) return null;
  return projectProductRunEvent({ productRunId, event: input.event });
}

export async function listProductRuns(input: { now?: string; statuses?: string[] } = {}) {
  const now = input.now ?? new Date().toISOString();
  const statuses = input.statuses === undefined
    ? undefined
    : z.array(productRunDisplayStateSchema).max(5).parse(input.statuses);
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.select({ run: productRuns, signalSummary: docsSignals.sourceSummary })
      .from(productRuns)
      .leftJoin(docsSignals, eq(productRuns.signalId, docsSignals.id))
      .where(eq(productRuns.workspaceId, DEFAULT_WORKSPACE_ID))
      .orderBy(desc(productRuns.startedAt), desc(productRuns.id));
    return rows.map(({ run, signalSummary }) => listItem(run, signalSummary, now))
      .filter((run) => statuses === undefined || statuses.includes(run.displayState));
  });
}

export async function getProductRunDetail(input: { id: string; now?: string }) {
  const id = nonEmpty.parse(input.id);
  return withDocsAgentDatabase((db) => getProductRunDetailWith(db, id, input.now));
}

export async function cleanupExpiredProductRuns(input: { now?: string; limit?: number } = {}) {
  const now = input.now ?? new Date().toISOString();
  const limit = z.number().int().min(1).max(500).parse(input.limit ?? 100);
  return withDocsAgentDatabase(async (db) => db.transaction(async (tx) => {
    const expired = await tx.select({ id: productRuns.id }).from(productRuns)
      .where(and(eq(productRuns.workspaceId, DEFAULT_WORKSPACE_ID), lte(productRuns.expiresAt, now)))
      .orderBy(asc(productRuns.expiresAt), asc(productRuns.id))
      .limit(limit);
    if (expired.length === 0) return { deleted: 0 };
    await tx.delete(productRuns).where(inArray(productRuns.id, expired.map(({ id }) => id)));
    return { deleted: expired.length };
  }));
}

type Executor = Pick<DocsAgentDatabase, "select" | "insert" | "update" | "delete">;

async function getProductRunDetailWith(db: Executor, id: string, now = new Date().toISOString()) {
  const rows = await db.select({ run: productRuns, signalSummary: docsSignals.sourceSummary })
    .from(productRuns)
    .leftJoin(docsSignals, eq(productRuns.signalId, docsSignals.id))
    .where(and(eq(productRuns.workspaceId, DEFAULT_WORKSPACE_ID), eq(productRuns.id, id)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error(`Product run not found: ${id}`);
  const steps = await db.select().from(productRunSteps)
    .where(eq(productRunSteps.productRunId, id))
    .orderBy(asc(productRunSteps.startedAt), asc(productRunSteps.stepKey));
  const traces = await db.select().from(productRunTraceLinks)
    .where(eq(productRunTraceLinks.productRunId, id))
    .orderBy(asc(productRunTraceLinks.kind));
  return operatorProductRunDetailSchema.parse({
    ...listItem(row.run, row.signalSummary, now),
    steps,
    traces: traces.map((trace) => ({
      id: trace.id,
      kind: trace.kind,
      label: trace.label,
      url: safeTraceUrl(trace.url),
      availability: trace.availability,
      unavailableReason: trace.unavailableReason,
    })),
    retentionDays: RETENTION_DAYS,
  });
}

function listItem(run: typeof productRuns.$inferSelect, signalSummary: string | null, now: string) {
  return operatorProductRunListItemSchema.parse({
    id: run.id,
    runType: run.runType,
    trigger: run.trigger,
    status: run.status,
    displayState: run.expiresAt <= now ? "expired" : run.status,
    sessionId: run.sessionId,
    runId: run.runId,
    signal: run.signalId === null ? null : { id: run.signalId, summary: signalSummary ?? "Related signal unavailable" },
    workflowId: run.workflowId,
    model: run.model,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cacheReadTokens: run.cacheReadTokens,
    waitingSummary: run.waitingSummary,
    failureSummary: run.failureSummary,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    expiresAt: run.expiresAt,
    updatedAt: run.updatedAt,
  });
}

async function projectStep(db: Executor, runId: string, eventType: string, data: Record<string, unknown>, at: string) {
  const stepKey = stringValue(data.stepId) ?? stringValue(data.stepKey) ?? numberValue(data.stepIndex)?.toString() ?? "step-0";
  const existing = await db.select().from(productRunSteps)
    .where(and(eq(productRunSteps.productRunId, runId), eq(productRunSteps.stepKey, stepKey)))
    .limit(1);
  const usage = usageValues(data);
  const status = eventType === "step.completed" ? "completed" : eventType === "step.failed" ? "failed" : "active";
  const values = {
    label: `Model step ${stepKey}`,
    status,
    model: stringValue(data.modelId) ?? stringValue(data.model) ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    failureSummary: eventType === "step.failed" ? safeFailure(data) : null,
    completedAt: status === "active" ? null : at,
    updatedAt: at,
  };
  if (existing[0] === undefined) {
    await db.insert(productRunSteps).values({ id: randomUUID(), productRunId: runId, workspaceId: DEFAULT_WORKSPACE_ID, stepKey, startedAt: at, ...values });
  } else {
    await db.update(productRunSteps).set(values).where(eq(productRunSteps.id, existing[0].id));
  }
}

async function refreshUsageFromSteps(db: Executor, runId: string, at: string) {
  const steps = await db.select({ inputTokens: productRunSteps.inputTokens, outputTokens: productRunSteps.outputTokens, cacheReadTokens: productRunSteps.cacheReadTokens, model: productRunSteps.model })
    .from(productRunSteps).where(eq(productRunSteps.productRunId, runId));
  await db.update(productRuns).set({
    inputTokens: steps.reduce((sum, step) => sum + step.inputTokens, 0),
    outputTokens: steps.reduce((sum, step) => sum + step.outputTokens, 0),
    cacheReadTokens: steps.reduce((sum, step) => sum + step.cacheReadTokens, 0),
    model: [...steps].reverse().find((step) => step.model !== null)?.model ?? undefined,
    updatedAt: at,
  }).where(eq(productRuns.id, runId));
}

async function updateStatus(db: Executor, id: string, status: string, at: string, waitingSummary: string | null, failureSummary: string | null, completedAt: string | null) {
  await db.update(productRuns).set({ status, waitingSummary, failureSummary, completedAt, updatedAt: at })
    .where(eq(productRuns.id, id));
}

async function readByOperationKey(db: Executor, operationKey: string) {
  const rows = await db.select().from(productRuns).where(and(eq(productRuns.workspaceId, DEFAULT_WORKSPACE_ID), eq(productRuns.operationKey, operationKey))).limit(1);
  return rows[0] ?? null;
}
async function requireRun(db: Executor, id: string) {
  const rows = await db.select().from(productRuns).where(and(eq(productRuns.workspaceId, DEFAULT_WORKSPACE_ID), eq(productRuns.id, id))).limit(1);
  if (rows[0] === undefined) throw new Error(`Product run not found: ${id}`);
  return rows[0];
}
async function assertSignalExists(db: Executor, id: string) {
  const rows = await db.select({ id: docsSignals.id }).from(docsSignals).where(and(eq(docsSignals.workspaceId, DEFAULT_WORKSPACE_ID), eq(docsSignals.id, id))).limit(1);
  if (rows.length !== 1) throw new Error(`Docs signal not found: ${id}`);
}

function usageValues(data: Record<string, unknown>) {
  const usage = record(data.usage);
  return {
    inputTokens: numberValue(data.inputTokens) ?? numberValue(usage.inputTokens) ?? 0,
    outputTokens: numberValue(data.outputTokens) ?? numberValue(usage.outputTokens) ?? 0,
    cacheReadTokens: numberValue(data.cacheReadTokens) ?? numberValue(usage.cacheReadTokens) ?? 0,
  };
}
function safeFailure(data: Record<string, unknown>) {
  const error = record(data.error);
  const code = stringValue(data.code) ?? stringValue(error.code) ?? "runtime_failure";
  return `Eve reported ${code.replaceAll(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100)}.`;
}
function safeTraceUrl(value: string | null) {
  if (value === null) return null;
  try {
    const url = new URL(value);
    const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !loopback) || url.username !== "" || url.password !== "") return null;
    if ([...url.searchParams.keys()].some((key) => /token|secret|password|authorization|credential|api[-_]?key/i.test(key))) return null;
    return url.toString();
  } catch { return null; }
}
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined; }
function isTerminal(status: string) { return status === "failed" || status === "completed"; }
function addDays(value: string, days: number) { return new Date(new Date(value).getTime() + days * 86_400_000).toISOString(); }
