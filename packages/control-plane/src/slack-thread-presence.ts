import { randomUUID } from "node:crypto";

import { and, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.js";
import { slackThreadPresences } from "./db/schema.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";

export const SLACK_THREAD_PRESENCE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export const slackThreadPresenceStatusSchema = z.enum([
  "active",
  "dismissed",
  "resolved",
  "expired",
  "enrollment-failed",
]);

export const slackThreadPresenceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  teamId: z.string().nullable(),
  channelId: z.string(),
  threadTs: z.string(),
  chatThreadId: z.string(),
  continuationToken: z.string(),
  inviterUserId: z.string(),
  status: slackThreadPresenceStatusSchema,
  enrolledAt: z.number().int(),
  lastActivityAt: z.number().int(),
  expiresAt: z.number().int(),
  endedAt: z.number().int().nullable(),
  endReason: z.string().nullable(),
});

export type SlackThreadPresence = z.infer<typeof slackThreadPresenceSchema>;

const enrollInputSchema = z.object({
  teamId: z.string().trim().min(1).optional(),
  channelId: z.string().trim().min(1),
  threadTs: z.string().trim().min(1),
  chatThreadId: z.string().trim().min(1),
  continuationToken: z.string().trim().min(1),
  inviterUserId: z.string().trim().min(1),
  nowMs: z.number().int().optional(),
  ttlMs: z.number().int().positive().default(SLACK_THREAD_PRESENCE_TTL_MS),
});

const continuationInputSchema = z.object({
  chatThreadId: z.string().trim().min(1),
  nowMs: z.number().int().optional(),
  ttlMs: z.number().int().positive().default(SLACK_THREAD_PRESENCE_TTL_MS),
});

const endInputSchema = z.object({
  chatThreadId: z.string().trim().min(1),
  status: z.enum(["dismissed", "resolved", "enrollment-failed"]),
  reason: z.string().trim().min(1),
  nowMs: z.number().int().optional(),
});

const resolveForSignalInputSchema = z.object({
  channelId: z.string().trim().min(1),
  threadTs: z.string().trim().min(1),
  signalId: z.string().trim().min(1),
  nowMs: z.number().int().optional(),
});

export async function enrollSlackThreadPresence(
  input: z.input<typeof enrollInputSchema>,
): Promise<SlackThreadPresence> {
  const value = enrollInputSchema.parse(input);
  const now = value.nowMs ?? Date.now();
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .insert(slackThreadPresences)
      .values({
        id: randomUUID(),
        workspaceId: DEFAULT_WORKSPACE_ID,
        teamId: value.teamId,
        channelId: value.channelId,
        threadTs: value.threadTs,
        chatThreadId: value.chatThreadId,
        continuationToken: value.continuationToken,
        inviterUserId: value.inviterUserId,
        status: "active",
        enrolledAt: now,
        lastActivityAt: now,
        expiresAt: now + value.ttlMs,
        endedAt: null,
        endReason: null,
      })
      .onConflictDoUpdate({
        target: [
          slackThreadPresences.workspaceId,
          slackThreadPresences.channelId,
          slackThreadPresences.threadTs,
        ],
        set: {
          teamId: value.teamId,
          chatThreadId: value.chatThreadId,
          continuationToken: value.continuationToken,
          inviterUserId: value.inviterUserId,
          status: "active",
          enrolledAt: now,
          lastActivityAt: now,
          expiresAt: now + value.ttlMs,
          endedAt: null,
          endReason: null,
        },
      })
      .returning();
    return slackThreadPresenceSchema.parse(rows[0]);
  });
}

export async function continueSlackThreadPresence(
  input: z.input<typeof continuationInputSchema>,
): Promise<{ admitted: boolean; presence: SlackThreadPresence | null }> {
  const value = continuationInputSchema.parse(input);
  const now = value.nowMs ?? Date.now();
  return withDocsAgentDatabase(async (db) => {
    const active = await db
      .update(slackThreadPresences)
      .set({ lastActivityAt: now, expiresAt: now + value.ttlMs })
      .where(
        and(
          eq(slackThreadPresences.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(slackThreadPresences.chatThreadId, value.chatThreadId),
          eq(slackThreadPresences.status, "active"),
          gt(slackThreadPresences.expiresAt, now),
        ),
      )
      .returning();
    if (active[0]) {
      return { admitted: true, presence: slackThreadPresenceSchema.parse(active[0]) };
    }

    const expired = await db
      .update(slackThreadPresences)
      .set({ status: "expired", endedAt: now, endReason: "inactivity-expiry" })
      .where(
        and(
          eq(slackThreadPresences.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(slackThreadPresences.chatThreadId, value.chatThreadId),
          eq(slackThreadPresences.status, "active"),
          lte(slackThreadPresences.expiresAt, now),
        ),
      )
      .returning();
    return {
      admitted: false,
      presence: expired[0] ? slackThreadPresenceSchema.parse(expired[0]) : null,
    };
  });
}

export async function endSlackThreadPresence(
  input: z.input<typeof endInputSchema>,
): Promise<SlackThreadPresence | null> {
  const value = endInputSchema.parse(input);
  const now = value.nowMs ?? Date.now();
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .update(slackThreadPresences)
      .set({ status: value.status, endedAt: now, endReason: value.reason })
      .where(
        and(
          eq(slackThreadPresences.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(slackThreadPresences.chatThreadId, value.chatThreadId),
          eq(slackThreadPresences.status, "active"),
        ),
      )
      .returning();
    return rows[0] ? slackThreadPresenceSchema.parse(rows[0]) : null;
  });
}

export async function resolveSlackThreadPresenceForSignal(
  input: z.input<typeof resolveForSignalInputSchema>,
): Promise<SlackThreadPresence | null> {
  const value = resolveForSignalInputSchema.parse(input);
  const now = value.nowMs ?? Date.now();
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .update(slackThreadPresences)
      .set({
        status: "resolved",
        endedAt: now,
        endReason: `docs-signal-resolved:${value.signalId}`,
      })
      .where(
        and(
          eq(slackThreadPresences.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(slackThreadPresences.channelId, value.channelId),
          eq(slackThreadPresences.threadTs, value.threadTs),
          eq(slackThreadPresences.status, "active"),
        ),
      )
      .returning();
    return rows[0] ? slackThreadPresenceSchema.parse(rows[0]) : null;
  });
}
