import { createHash } from "node:crypto";

import { z } from "zod";

import {
  createInternalDocument,
  internalDocumentSchema,
  internalDocumentSourceReferencesSchema,
  type InternalDocumentAttachmentTarget,
} from "./internal-documents.ts";
import {
  resolveWatchRuntimeContext,
  watchRuntimeContextSchema,
} from "./watch-runtime.ts";
import type { WatchServiceContext } from "./watch-service-readiness.ts";

const identifierSchema = z.string().trim().min(1).max(200);

export const watchContinuityContextSchema = z.object({
  runtime: watchRuntimeContextSchema,
  document: internalDocumentSchema.nullable(),
}).strict();

export const watchContinuityCommandSchema = z.object({
  sessionId: identifierSchema,
  runId: identifierSchema,
  now: z.date().optional(),
}).strict();

export type WatchContinuityContext = z.infer<typeof watchContinuityContextSchema>;
export type WatchContinuityCommand = z.infer<typeof watchContinuityCommandSchema>;

export async function resolveWatchContinuityContext(
  reservationId: string,
  serviceContext: WatchServiceContext,
  commandInput: WatchContinuityCommand,
  options: { claimToken?: string } = {},
): Promise<WatchContinuityContext> {
  const command = watchContinuityCommandSchema.parse(commandInput);
  const runtime = await resolveWatchRuntimeContext(
    reservationId,
    serviceContext,
    options,
  );
  if (!runtime.capabilityGrants.includes("docs_work.manage")) {
    return watchContinuityContextSchema.parse({ runtime, document: null });
  }

  const attachment = watchContinuityAttachment(runtime.watchId);
  const created = await createInternalDocument({
    title: "Watch continuity",
    kind: "watch-continuity",
    editingProfile: "living-summary",
    content: "# Watch continuity\n\nNo durable findings recorded yet.",
    retentionDays: runtime.auditRetentionDays,
    attachment,
    sourceReferences: watchContinuitySourceReferences(runtime),
  }, {
    authority: "docs_work.manage",
    actor: { type: "agent", id: "paige-agent" },
    sessionId: command.sessionId,
    runId: command.runId,
    operationKey: continuityOperationKey(runtime.reservationId, command),
    ...(command.now === undefined ? {} : { now: command.now }),
  });
  return watchContinuityContextSchema.parse({
    runtime,
    document: created.document,
  });
}

export function watchContinuityAttachment(
  watchId: string,
): InternalDocumentAttachmentTarget {
  return {
    resourceType: "policy-bound-watch",
    resourceId: watchId,
    relationship: "continuity",
  };
}

export function watchContinuitySourceReferences(
  runtime: z.infer<typeof watchRuntimeContextSchema>,
) {
  return internalDocumentSourceReferencesSchema.parse([
    { kind: "policy-bound-watch", id: runtime.watchId },
    { kind: "watch-effective-revision", id: runtime.effectiveRevisionId },
    { kind: "watch-occurrence", id: runtime.reservationId },
  ]);
}

function continuityOperationKey(
  reservationId: string,
  command: WatchContinuityCommand,
): string {
  return createHash("sha256").update(JSON.stringify([
    "watch-continuity",
    reservationId,
    command.sessionId,
    command.runId,
  ])).digest("hex");
}
