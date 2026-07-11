import "server-only";

import {
  listDocsSignalQueue,
  type DocsSignalQueueItem,
  type DocsSignalSourceKind,
  type DocsSignalStatus,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_SIGNAL_TEST_SCENARIOS";

export type SignalQueueFilters = {
  status?: DocsSignalStatus;
  sourceKind?: DocsSignalSourceKind;
  includeClosed: boolean;
};

export type SignalQueueResult =
  | { state: "ready"; signals: DocsSignalQueueItem[] }
  | { state: "empty" }
  | { state: "database-error"; message: string }
  | { state: "invalid-record"; message: string };

export async function resolveSignalQueue(
  filters: SignalQueueFilters,
  requestedScenario?: string,
): Promise<SignalQueueResult> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    return fixtureResult(requestedScenario ?? "ready", filters);
  }

  try {
    const result = await listDocsSignalQueue({
      statuses: filters.status === undefined ? [] : [filters.status],
      sourceKinds: filters.sourceKind === undefined ? [] : [filters.sourceKind],
      openOnly: !filters.includeClosed,
      limit: 100,
    });

    return result.signals.length === 0
      ? { state: "empty" }
      : { state: "ready", signals: result.signals };
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return {
        state: "invalid-record",
        message: "A persisted signal does not match the current queue contract.",
      };
    }

    return {
      state: "database-error",
      message: "The app-owned signal database could not be read.",
    };
  }
}

function fixtureResult(
  scenario: string,
  filters: SignalQueueFilters,
): SignalQueueResult {
  if (scenario === "empty") return { state: "empty" };
  if (scenario === "database-error") {
    return {
      state: "database-error",
      message: "The app-owned signal database could not be read.",
    };
  }
  if (scenario === "invalid-record") {
    return {
      state: "invalid-record",
      message: "A persisted signal does not match the current queue contract.",
    };
  }

  const closedStatuses = new Set<DocsSignalStatus>([
    "closed-already-covered",
    "closed-not-docs-relevant",
  ]);
  const signals = fixtureSignals
    .filter((signal) => filters.status === undefined || signal.status === filters.status)
    .filter(
      (signal) => filters.sourceKind === undefined || signal.sourceKind === filters.sourceKind,
    )
    .filter(
      (signal) =>
        filters.status !== undefined || filters.includeClosed || !closedStatuses.has(signal.status),
    );

  return signals.length === 0
    ? { state: "empty" }
    : { state: "ready", signals };
}

const fixtureSignals: DocsSignalQueueItem[] = [
  fixtureSignal({
    id: "signal-release-verification",
    status: "needs-source-evidence",
    sourceKind: "watched-release",
    sourceSummary: "Confirm whether the new webhook retry contract changes the integration guide.",
    uncertainty: "The release note does not name the affected API versions.",
    priority: 92,
    nextActionAt: "2026-07-12T08:30:00.000Z",
    updatedAt: "2026-07-11T15:40:00.000Z",
  }),
  fixtureSignal({
    id: "signal-linear-metadata",
    status: "docs-verified",
    sourceKind: "linear-issue",
    sourceSummary: "Private metadata filtering needs a focused conceptual docs update.",
    uncertainty: null,
    priority: 78,
    nextActionAt: "2026-07-12T11:00:00.000Z",
    updatedAt: "2026-07-11T17:05:00.000Z",
  }),
  fixtureSignal({
    id: "signal-slack-checkout",
    status: "captured",
    sourceKind: "slack-thread",
    sourceSummary: "Investigate whether checkout completion guidance still matches runtime behavior.",
    uncertainty: "The report has not yet been checked against source or current docs.",
    priority: 54,
    nextActionAt: null,
    updatedAt: "2026-07-11T18:25:00.000Z",
  }),
  fixtureSignal({
    id: "signal-closed-limit",
    status: "closed-already-covered",
    sourceKind: "manual-scenario",
    sourceSummary: "The public sandbox rate-limit documentation is already correct.",
    uncertainty: null,
    priority: 40,
    nextActionAt: null,
    updatedAt: "2026-07-11T19:10:00.000Z",
  }),
];

function fixtureSignal(
  input: Pick<
    DocsSignalQueueItem,
    | "id"
    | "status"
    | "sourceKind"
    | "sourceSummary"
    | "uncertainty"
    | "priority"
    | "nextActionAt"
    | "updatedAt"
  >,
): DocsSignalQueueItem {
  return {
    ...input,
  };
}
