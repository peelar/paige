import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.ts";
import { capabilityResolutionEvents } from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";
import { capabilityFamilySchema } from "./capability-contract.ts";

const identifierSchema = z.string().trim().min(1).max(500);
const runtimeIdSchema = z.string().trim().min(1).max(500);
const toolNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/u).max(160);

export const capabilityResolutionContextSchema = z.enum([
  "eve",
  "slack",
  "linear",
  "schedule",
  "watch",
  "approval-resume",
  "unknown",
]);

export const capabilityResolutionReasonSchema = z.enum([
  "interactive-principal",
  "slack-principal",
  "linear-principal",
  "schedule-principal",
  "watch-authority",
  "approved-publication-resume",
  "setup-not-ready",
  "writeback-not-ready",
  "prepared-draft-unavailable",
  "watch-authority-unavailable",
  "principal-unverified",
  "resolver-failure",
]);

export const capabilityResolutionEventSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  sessionId: identifierSchema,
  turnId: identifierSchema,
  contextClass: capabilityResolutionContextSchema,
  status: z.enum(["resolved", "denied"]),
  capabilityFamilies: z.array(capabilityFamilySchema).max(7),
  toolNames: z.array(toolNameSchema).max(64),
  reasonCodes: z.array(capabilityResolutionReasonSchema).max(12),
  reservationId: runtimeIdSchema.nullable(),
  watchId: runtimeIdSchema.nullable(),
  effectiveRevisionId: runtimeIdSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const recordCapabilityResolutionInputSchema = capabilityResolutionEventSchema
  .omit({ id: true, createdAt: true })
  .strict();

export type CapabilityResolutionEvent = z.infer<typeof capabilityResolutionEventSchema>;
export type RecordCapabilityResolutionInput = z.infer<typeof recordCapabilityResolutionInputSchema>;

export async function recordCapabilityResolution(
  input: RecordCapabilityResolutionInput,
): Promise<CapabilityResolutionEvent> {
  const parsed = normalizeProjection(recordCapabilityResolutionInputSchema.parse(input));
  const id = resolutionId(parsed);
  const createdAt = new Date().toISOString();

  return withDocsAgentDatabase(async (db) => {
    await db.insert(capabilityResolutionEvents).values({
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      ...parsed,
      createdAt,
    }).onConflictDoNothing({ target: capabilityResolutionEvents.id });
    const rows = await db.select().from(capabilityResolutionEvents).where(and(
      eq(capabilityResolutionEvents.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(capabilityResolutionEvents.id, id),
    )).limit(1);
    const event = rows[0];
    if (event === undefined) {
      throw new Error("The capability-resolution projection was not persisted.");
    }
    return projectStoredResolution(event);
  });
}

export async function listCapabilityResolutions(input: {
  sessionId: string;
  limit?: number;
}): Promise<CapabilityResolutionEvent[]> {
  const sessionId = identifierSchema.parse(input.sessionId);
  const limit = z.number().int().min(1).max(100).parse(input.limit ?? 20);
  return withDocsAgentDatabase(async (db) => {
    const rows = await db.select().from(capabilityResolutionEvents).where(and(
      eq(capabilityResolutionEvents.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(capabilityResolutionEvents.sessionId, sessionId),
    )).orderBy(desc(capabilityResolutionEvents.createdAt), desc(capabilityResolutionEvents.id)).limit(limit);
    return rows.map(projectStoredResolution);
  });
}

function normalizeProjection(
  input: RecordCapabilityResolutionInput,
): RecordCapabilityResolutionInput {
  return {
    ...input,
    capabilityFamilies: [...new Set(input.capabilityFamilies)].sort(),
    toolNames: [...new Set(input.toolNames)].sort(),
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
  };
}

function projectStoredResolution(
  event: typeof capabilityResolutionEvents.$inferSelect,
): CapabilityResolutionEvent {
  return capabilityResolutionEventSchema.parse({
    id: event.id,
    sessionId: event.sessionId,
    turnId: event.turnId,
    contextClass: event.contextClass,
    status: event.status,
    capabilityFamilies: event.capabilityFamilies,
    toolNames: event.toolNames,
    reasonCodes: event.reasonCodes,
    reservationId: event.reservationId,
    watchId: event.watchId,
    effectiveRevisionId: event.effectiveRevisionId,
    createdAt: event.createdAt,
  });
}

function resolutionId(input: RecordCapabilityResolutionInput): string {
  return createHash("sha256").update(JSON.stringify([
    "capability-resolution-v1",
    input.sessionId,
    input.turnId,
    input.contextClass,
    input.status,
    input.capabilityFamilies,
    input.toolNames,
    input.reasonCodes,
    input.reservationId,
    input.watchId,
    input.effectiveRevisionId,
  ])).digest("hex");
}
