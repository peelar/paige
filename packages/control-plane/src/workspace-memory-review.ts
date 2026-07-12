import { z } from "zod";

import { safeExternalUrl } from "./signal-detail.js";
import {
  getWorkspaceMemory,
  listWorkspaceMemoryRecords,
  markWorkspaceMemoryStale,
  promoteWorkspaceMemory,
  retireWorkspaceMemory,
  workspaceMemoryConfidenceSchema,
  workspaceMemoryFreshnessStateSchema,
  workspaceMemoryKindSchema,
  workspaceMemorySourceKindSchema,
  workspaceMemoryStatusSchema,
  type WorkspaceMemoryDetail,
  type WorkspaceMemoryRecord,
} from "./workspace-memory.js";

export const operatorMemoryDisplayStateSchema = z.enum([
  "proposed",
  "active-fresh",
  "active-expired",
  "active-undated",
  "stale",
  "retired",
]);

export const operatorMemoryListItemSchema = z.object({
  id: z.string(),
  kind: workspaceMemoryKindSchema,
  status: workspaceMemoryStatusSchema,
  displayState: operatorMemoryDisplayStateSchema,
  statement: z.string(),
  scope: z.string().nullable(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  confidence: workspaceMemoryConfidenceSchema,
  freshnessState: workspaceMemoryFreshnessStateSchema,
  freshUntil: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  staleReason: z.string().nullable(),
  proposedBy: z.string(),
  updatedAt: z.string(),
});

export const operatorMemoryListInputSchema = z.object({
  status: workspaceMemoryStatusSchema.optional(),
  kind: workspaceMemoryKindSchema.optional(),
  query: z.string().trim().max(200).optional(),
}).strict();

export const operatorMemoryListResultSchema = z.object({
  records: z.array(operatorMemoryListItemSchema),
});

export const operatorMemoryDetailSchema = operatorMemoryListItemSchema.extend({
  promotedAt: z.string().nullable(),
  retiredAt: z.string().nullable(),
  createdAt: z.string(),
  sources: z.array(z.object({
    id: z.string(),
    kind: workspaceMemorySourceKindSchema,
    label: z.string().nullable(),
    url: z.string().nullable(),
    sourceText: z.string().nullable(),
    createdAt: z.string(),
  })),
  events: z.array(z.object({
    id: z.string(),
    eventType: z.string(),
    fromStatus: workspaceMemoryStatusSchema.nullable(),
    toStatus: workspaceMemoryStatusSchema.nullable(),
    reason: z.string(),
    actor: z.string(),
    createdAt: z.string(),
  })),
});

export const operatorMemoryMutationInputSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(["promote", "mark-stale", "retire"]),
  reason: z.string().trim().min(1).max(1_000),
  actor: z.string().trim().min(1),
}).strict();

export type OperatorMemoryDisplayState = z.infer<
  typeof operatorMemoryDisplayStateSchema
>;
export type OperatorMemoryListItem = z.infer<typeof operatorMemoryListItemSchema>;
export type OperatorMemoryListInput = z.infer<typeof operatorMemoryListInputSchema>;
export type OperatorMemoryListResult = z.infer<typeof operatorMemoryListResultSchema>;
export type OperatorMemoryDetail = z.infer<typeof operatorMemoryDetailSchema>;
export type OperatorMemoryMutationInput = z.infer<
  typeof operatorMemoryMutationInputSchema
>;

export class OperatorMemoryTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorMemoryTransitionError";
  }
}

export async function listOperatorMemories(
  input: OperatorMemoryListInput = {},
): Promise<OperatorMemoryListResult> {
  const parsed = operatorMemoryListInputSchema.parse(input);
  const records = await listWorkspaceMemoryRecords({
    statuses: parsed.status === undefined
      ? workspaceMemoryStatusSchema.options
      : [parsed.status],
    kinds: parsed.kind === undefined ? [] : [parsed.kind],
    limit: 100,
  });
  const query = parsed.query?.toLocaleLowerCase("en");
  const filtered = query === undefined
    ? records
    : records.filter((record) =>
        [
          record.statement,
          record.scope ?? "",
          record.summary ?? "",
          ...record.tags,
        ].some((value) => value.toLocaleLowerCase("en").includes(query)),
      );

  return operatorMemoryListResultSchema.parse({
    records: filtered.map(projectListItem),
  });
}

export async function getOperatorMemoryDetail(input: {
  id: string;
}): Promise<OperatorMemoryDetail> {
  return projectDetail(await getWorkspaceMemory(input));
}

export async function mutateOperatorMemory(
  input: OperatorMemoryMutationInput,
): Promise<OperatorMemoryDetail> {
  const parsed = operatorMemoryMutationInputSchema.parse(input);
  const current = await getWorkspaceMemory({ id: parsed.id });

  if (parsed.action === "promote") {
    if (current.status !== "proposed") {
      throw new OperatorMemoryTransitionError(
        "Only a proposed workspace memory can be promoted from the operator app.",
      );
    }
    return projectDetail(await promoteWorkspaceMemory({
      id: parsed.id,
      reason: parsed.reason,
      actor: parsed.actor,
    }));
  }

  if (parsed.action === "mark-stale") {
    if (current.status !== "active") {
      throw new OperatorMemoryTransitionError(
        "Only an active workspace memory can be marked stale from the operator app.",
      );
    }
    return projectDetail(await markWorkspaceMemoryStale({
      id: parsed.id,
      reason: parsed.reason,
      actor: parsed.actor,
    }));
  }

  if (current.status !== "active" && current.status !== "stale") {
    throw new OperatorMemoryTransitionError(
      "Only an active or stale workspace memory can be retired from the operator app.",
    );
  }
  return projectDetail(await retireWorkspaceMemory({
    id: parsed.id,
    reason: parsed.reason,
    actor: parsed.actor,
  }));
}

function projectListItem(record: WorkspaceMemoryRecord): OperatorMemoryListItem {
  return operatorMemoryListItemSchema.parse({
    id: record.id,
    kind: record.kind,
    status: record.status,
    displayState: displayState(record),
    statement: record.statement,
    scope: record.scope,
    summary: record.summary,
    tags: record.tags,
    confidence: record.confidence,
    freshnessState: record.freshnessState,
    freshUntil: record.freshUntil,
    lastValidatedAt: record.lastValidatedAt,
    staleReason: record.staleReason,
    proposedBy: record.proposedBy,
    updatedAt: record.updatedAt,
  });
}

function projectDetail(record: WorkspaceMemoryDetail): OperatorMemoryDetail {
  return operatorMemoryDetailSchema.parse({
    ...projectListItem(record),
    promotedAt: record.promotedAt,
    retiredAt: record.retiredAt,
    createdAt: record.createdAt,
    sources: record.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      url: safeExternalUrl(source.url),
      sourceText: source.sourceText,
      createdAt: source.createdAt,
    })),
    events: record.events
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        actor: event.actor,
        createdAt: event.createdAt,
      }))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
      ),
  });
}

function displayState(record: WorkspaceMemoryRecord): OperatorMemoryDisplayState {
  if (record.status === "proposed") return "proposed";
  if (record.status === "stale") return "stale";
  if (record.status === "retired") return "retired";
  if (record.freshnessState === "fresh") return "active-fresh";
  if (record.freshnessState === "stale") return "active-expired";
  return "active-undated";
}
