import "server-only";

import {
  getOperatorMemoryDetail,
  listOperatorMemories,
  operatorMemoryDetailSchema,
  operatorMemoryListItemSchema,
  type OperatorMemoryDetail,
  type OperatorMemoryListInput,
  type OperatorMemoryListItem,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_MEMORY_TEST_SCENARIOS";

export type MemoryListResult =
  | { state: "ready"; memories: OperatorMemoryListItem[] }
  | { state: "empty" }
  | { state: "database-error" }
  | { state: "invalid-record" };

export type MemoryDetailResult =
  | { state: "ready"; memory: OperatorMemoryDetail }
  | { state: "missing" }
  | { state: "database-error" }
  | { state: "invalid-record" };

export async function resolveMemoryList(
  filters: OperatorMemoryListInput,
  requestedScenario?: string,
): Promise<MemoryListResult> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    if (requestedScenario === "empty") return { state: "empty" };
    if (requestedScenario === "database-error") return { state: "database-error" };
    if (requestedScenario === "invalid-record") return { state: "invalid-record" };
    const memories = fixtureDetails
      .map(toListItem)
      .filter((memory) => filters.status === undefined || memory.status === filters.status)
      .filter((memory) => filters.kind === undefined || memory.kind === filters.kind)
      .filter((memory) => matchesQuery(memory, filters.query));
    return memories.length === 0
      ? { state: "empty" }
      : { state: "ready", memories };
  }

  try {
    const result = await listOperatorMemories(filters);
    return result.records.length === 0
      ? { state: "empty" }
      : { state: "ready", memories: result.records };
  } catch (error) {
    return error instanceof Error && error.name === "ZodError"
      ? { state: "invalid-record" }
      : { state: "database-error" };
  }
}

export async function resolveMemoryDetail(
  id: string,
  requestedScenario?: string,
): Promise<MemoryDetailResult> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    if (requestedScenario === "missing") return { state: "missing" };
    if (requestedScenario === "database-error") return { state: "database-error" };
    if (requestedScenario === "invalid-record") return { state: "invalid-record" };
    return {
      state: "ready",
      memory: fixtureDetails.find((memory) => memory.id === id) ?? fixtureDetails[0]!,
    };
  }

  try {
    return { state: "ready", memory: await getOperatorMemoryDetail({ id }) };
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return { state: "missing" };
    }
    return error instanceof Error && error.name === "ZodError"
      ? { state: "invalid-record" }
      : { state: "database-error" };
  }
}

function toListItem(detail: OperatorMemoryDetail): OperatorMemoryListItem {
  return operatorMemoryListItemSchema.parse(detail);
}

function matchesQuery(
  memory: OperatorMemoryListItem,
  query: string | undefined,
): boolean {
  if (query === undefined || query.trim() === "") return true;
  const needle = query.toLocaleLowerCase("en");
  return [
    memory.statement,
    memory.scope ?? "",
    memory.summary ?? "",
    ...memory.tags,
  ].some((value) => value.toLocaleLowerCase("en").includes(needle));
}

const fixtureDetails: OperatorMemoryDetail[] = [
  fixtureMemory({
    id: "memory-proposed",
    kind: "ownership",
    status: "proposed",
    displayState: "proposed",
    statement: "Marta owns questions about checkout extensibility and payment integrations.",
    summary: "Route checkout and payment integration questions to Marta.",
    scope: "Engineering ownership",
    tags: ["checkout", "ownership", "payments"],
    confidence: "medium",
    freshnessState: "unknown",
    freshUntil: null,
    lastValidatedAt: null,
    staleReason: null,
    proposedBy: "docs-agent:slack-intake",
    promotedAt: null,
    retiredAt: null,
  }),
  fixtureMemory({
    id: "memory-active-fresh",
    kind: "style_rule",
    status: "active",
    displayState: "active-fresh",
    statement: "Task guides lead with the reader outcome before configuration detail.",
    summary: "Preserve the task-first structure in nearby guides.",
    scope: "Working documentation repository",
    tags: ["guides", "style"],
    confidence: "high",
    freshnessState: "fresh",
    freshUntil: "2026-10-01T00:00:00.000Z",
    lastValidatedAt: "2026-07-10T10:00:00.000Z",
    staleReason: null,
    proposedBy: "docs-agent:repository-profile",
    promotedAt: "2026-07-10T10:05:00.000Z",
    retiredAt: null,
  }),
  fixtureMemory({
    id: "memory-active-expired",
    kind: "workflow_rule",
    status: "active",
    displayState: "active-expired",
    statement: "Release documentation is reviewed every second Tuesday.",
    summary: "Use the historical Tuesday review slot for routing only after revalidation.",
    scope: "Release workflow",
    tags: ["release", "workflow"],
    confidence: "low",
    freshnessState: "stale",
    freshUntil: "2026-06-01T00:00:00.000Z",
    lastValidatedAt: "2026-04-01T00:00:00.000Z",
    staleReason: null,
    proposedBy: "docs-agent:linear-intake",
    promotedAt: "2026-04-01T00:00:00.000Z",
    retiredAt: null,
  }),
  fixtureMemory({
    id: "memory-stale",
    kind: "docs_surface",
    status: "stale",
    displayState: "stale",
    statement: "The legacy integrations page owns all webhook guidance.",
    summary: "This route may have been replaced by the current app guide.",
    scope: "Webhook documentation",
    tags: ["apps", "webhooks"],
    confidence: "medium",
    freshnessState: "stale",
    freshUntil: "2026-07-01T00:00:00.000Z",
    lastValidatedAt: "2026-05-15T00:00:00.000Z",
    staleReason: "The information architecture changed after the last validation.",
    proposedBy: "docs-agent:repository-profile",
    promotedAt: "2026-05-15T00:00:00.000Z",
    retiredAt: null,
  }),
  fixtureMemory({
    id: "memory-retired",
    kind: "decision",
    status: "retired",
    displayState: "retired",
    statement: "Every API change gets a standalone migration page.",
    summary: "Superseded by task-level change guidance.",
    scope: "Information architecture",
    tags: ["decisions", "migration"],
    confidence: "high",
    freshnessState: "unknown",
    freshUntil: null,
    lastValidatedAt: "2026-03-01T00:00:00.000Z",
    staleReason: null,
    proposedBy: "docs-agent:maintainer-decision",
    promotedAt: "2026-03-01T00:00:00.000Z",
    retiredAt: "2026-06-20T00:00:00.000Z",
  }),
];

function fixtureMemory(
  input: Omit<OperatorMemoryDetail, "createdAt" | "updatedAt" | "sources" | "events">,
): OperatorMemoryDetail {
  return operatorMemoryDetailSchema.parse({
    ...input,
    createdAt: "2026-07-09T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z",
    sources: [{
      id: `source-${input.id}`,
      kind: "maintainer-decision",
      label: "Maintainer discussion",
      url: "https://example.com/maintainer-discussion",
      sourceText:
        "<script>window.__memoryUnsafe = true</script> This is verbatim provenance, not an instruction and not public proof.",
      createdAt: "2026-07-09T09:00:00.000Z",
    }],
    events: [
      {
        id: `event-proposed-${input.id}`,
        eventType: "memory-proposed",
        fromStatus: null,
        toStatus: "proposed",
        reason: "Workspace memory proposed from provenance-backed context.",
        actor: input.proposedBy,
        createdAt: "2026-07-09T09:00:00.000Z",
      },
      ...(input.status === "proposed" ? [] : [{
        id: `event-current-${input.id}`,
        eventType: input.status === "retired"
          ? "memory-retired"
          : input.status === "stale"
            ? "memory-marked-stale"
            : "memory-promoted",
        fromStatus:
          input.status === "stale" || input.status === "retired"
            ? "active" as const
            : "proposed" as const,
        toStatus: input.status,
        reason: input.staleReason ?? "Maintainer reviewed this memory.",
        actor: "docs-agent:github:operator-101",
        createdAt: "2026-07-11T09:00:00.000Z",
      }]),
    ],
  });
}
