import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  BEHAVIOR_SETTINGS_VERSION,
  behaviorSettingsSchema,
  behaviorSettingsStateSchema,
  DEFAULT_BEHAVIOR_SETTINGS,
  saveBehaviorSettingsInputSchema,
  type BehaviorSettings,
  type BehaviorSettingsState,
} from "./behavior-settings-contract.ts";
import { withDocsAgentDatabase } from "./db/client.ts";
import {
  workspaceBehaviorSettings,
  workspaceBehaviorSettingsEvents,
} from "./db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.ts";

export * from "./behavior-settings-contract.ts";

export async function readBehaviorSettings(
  auditLimit = 10,
): Promise<BehaviorSettingsState> {
  return withDocsAgentDatabase(async (db) => {
    const [rows, eventRows] = await Promise.all([
      db
        .select()
        .from(workspaceBehaviorSettings)
        .where(eq(workspaceBehaviorSettings.workspaceId, DEFAULT_WORKSPACE_ID))
        .limit(1),
      db
        .select()
        .from(workspaceBehaviorSettingsEvents)
        .where(eq(workspaceBehaviorSettingsEvents.workspaceId, DEFAULT_WORKSPACE_ID))
        .orderBy(
          desc(workspaceBehaviorSettingsEvents.createdAt),
          desc(workspaceBehaviorSettingsEvents.id),
        )
        .limit(Math.max(1, Math.min(auditLimit, 50))),
    ]);
    const row = rows[0];
    return behaviorSettingsStateSchema.parse({
      settings: row === undefined
        ? DEFAULT_BEHAVIOR_SETTINGS
        : behaviorSettingsSchema.parse(row.settings),
      source: row === undefined ? "default" : "persisted",
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row === undefined
        ? null
        : { id: row.updatedById, githubLogin: row.updatedByLogin },
      audit: eventRows.map((event) => ({
        id: event.id,
        actor: { id: event.actorId, githubLogin: event.actorLogin },
        previousSettings: behaviorSettingsSchema.parse(event.previousSettings),
        nextSettings: behaviorSettingsSchema.parse(event.nextSettings),
        createdAt: event.createdAt,
      })),
    });
  });
}

export async function saveBehaviorSettings(
  input: z.input<typeof saveBehaviorSettingsInputSchema>,
): Promise<BehaviorSettingsState> {
  const parsed = saveBehaviorSettingsInputSchema.parse(input);
  const now = new Date().toISOString();

  await withDocsAgentDatabase(async (db) => {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(workspaceBehaviorSettings)
        .where(eq(workspaceBehaviorSettings.workspaceId, DEFAULT_WORKSPACE_ID))
        .limit(1);
      const previousSettings = existing[0] === undefined
        ? DEFAULT_BEHAVIOR_SETTINGS
        : behaviorSettingsSchema.parse(existing[0].settings);

      if (sameSettings(previousSettings, parsed.settings) && existing[0] !== undefined) {
        return;
      }

      await tx
        .insert(workspaceBehaviorSettings)
        .values({
          workspaceId: DEFAULT_WORKSPACE_ID,
          version: BEHAVIOR_SETTINGS_VERSION,
          settings: parsed.settings,
          updatedById: parsed.actor.id,
          updatedByLogin: parsed.actor.githubLogin,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceBehaviorSettings.workspaceId,
          set: {
            version: BEHAVIOR_SETTINGS_VERSION,
            settings: parsed.settings,
            updatedById: parsed.actor.id,
            updatedByLogin: parsed.actor.githubLogin,
            updatedAt: now,
          },
        });
      await tx.insert(workspaceBehaviorSettingsEvents).values({
        id: randomUUID(),
        workspaceId: DEFAULT_WORKSPACE_ID,
        actorId: parsed.actor.id,
        actorLogin: parsed.actor.githubLogin,
        previousSettings,
        nextSettings: parsed.settings,
        createdAt: now,
      });
    });
  });

  return readBehaviorSettings();
}

function sameSettings(left: BehaviorSettings, right: BehaviorSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
