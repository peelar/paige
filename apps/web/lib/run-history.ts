import "server-only";

import {
  getProductRunDetail,
  listProductRuns,
  operatorProductRunDetailSchema,
  type OperatorProductRunDetail,
  type OperatorProductRunListItem,
} from "@docs-agent/control-plane";

const TEST_ENV = "DOCS_AGENT_RUN_TEST_SCENARIOS";

export type RunFilters = { query?: string; status?: OperatorProductRunListItem["displayState"]; runType?: OperatorProductRunListItem["runType"] };
export type RunListResult = { state: "ready"; runs: OperatorProductRunListItem[] } | { state: "empty" | "invalid-record" | "unauthorized" | "database-error" };
export type RunDetailResult = { state: "ready"; run: OperatorProductRunDetail } | { state: "missing" | "invalid-record" | "unauthorized" | "database-error" };

export async function resolveRunList(filters: RunFilters, scenario?: string): Promise<RunListResult> {
  if (process.env[TEST_ENV] === "1") {
    if (scenario === "empty") return { state: "empty" };
    if (scenario === "invalid-record") return { state: "invalid-record" };
    if (scenario === "unauthorized") return { state: "unauthorized" };
    if (scenario === "database-error") return { state: "database-error" };
    const runs = fixtureRuns.map(toList).filter((run) => matches(run, filters));
    return runs.length === 0 ? { state: "empty" } : { state: "ready", runs };
  }
  try {
    const runs = (await listProductRuns()).filter((run) => matches(run, filters));
    return runs.length === 0 ? { state: "empty" } : { state: "ready", runs };
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return { state: "invalid-record" };
    if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) return { state: "unauthorized" };
    return { state: "database-error" };
  }
}

export async function resolveRunDetail(id: string, scenario?: string): Promise<RunDetailResult> {
  if (process.env[TEST_ENV] === "1") {
    if (scenario === "missing") return { state: "missing" };
    if (scenario === "invalid-record") return { state: "invalid-record" };
    if (scenario === "unauthorized") return { state: "unauthorized" };
    if (scenario === "database-error") return { state: "database-error" };
    return { state: "ready", run: fixtureRuns.find((run) => run.id === id) ?? fixtureRuns[0]! };
  }
  try { return { state: "ready", run: await getProductRunDetail({ id }) }; }
  catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return { state: "missing" };
    if (error instanceof Error && error.name === "ZodError") return { state: "invalid-record" };
    if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) return { state: "unauthorized" };
    return { state: "database-error" };
  }
}

function matches(run: OperatorProductRunListItem, filters: RunFilters) {
  if (filters.status !== undefined && run.displayState !== filters.status) return false;
  if (filters.runType !== undefined && run.runType !== filters.runType) return false;
  if (filters.query === undefined) return true;
  const haystack = [run.id, run.sessionId, run.runId, run.signal?.id ?? "", run.signal?.summary ?? "", run.workflowId ?? "", run.model ?? ""].join(" ").toLowerCase();
  return haystack.includes(filters.query.toLowerCase());
}
function toList(run: OperatorProductRunDetail): OperatorProductRunListItem { const { steps: _steps, traces: _traces, retentionDays: _retention, ...item } = run; return item; }

const base = {
  trigger: "linear" as const,
  sessionId: "wrun_01J0DOCSAGENT",
  runId: "turn_0",
  signal: { id: "signal-DOCS-201", summary: "Document the metadata permission change." },
  workflowId: "owned:signal-DOCS-201",
  model: "openai/gpt-5",
  inputTokens: 12_480,
  outputTokens: 1_824,
  cacheReadTokens: 7_920,
  waitingSummary: null,
  failureSummary: null,
  startedAt: "2026-07-11T09:00:00.000Z",
  completedAt: null,
  expiresAt: "2026-08-10T09:00:00.000Z",
  updatedAt: "2026-07-11T09:04:00.000Z",
  steps: [{ id: "step-1", stepKey: "0", label: "Model step 0", status: "completed" as const, model: "openai/gpt-5", inputTokens: 12_480, outputTokens: 1_824, cacheReadTokens: 7_920, failureSummary: null, startedAt: "2026-07-11T09:00:02.000Z", completedAt: "2026-07-11T09:03:50.000Z", updatedAt: "2026-07-11T09:03:50.000Z" }],
  traces: [
    { id: "trace-eve", kind: "eve" as const, label: "Durable Eve event stream", url: "https://agent.example.com/eve/v1/session/wrun_01J0DOCSAGENT/stream", availability: "available" as const, unavailableReason: null },
    { id: "trace-vercel", kind: "vercel" as const, label: "Vercel Agent Run", url: null, availability: "unavailable" as const, unavailableReason: "The current operator does not have access to this deployment trace." },
    { id: "trace-otel", kind: "opentelemetry" as const, label: "OpenTelemetry trace", url: "https://observability.example.com/traces/trace-201", availability: "available" as const, unavailableReason: null },
  ],
  retentionDays: 30 as const,
};

const fixtureRuns: OperatorProductRunDetail[] = [
  operatorProductRunDetailSchema.parse({ ...base, id: "run-active", runType: "docs-verification", status: "active", displayState: "active" }),
  operatorProductRunDetailSchema.parse({ ...base, id: "run-waiting", runType: "patch-preparation", status: "waiting-for-input", displayState: "waiting-for-input", waitingSummary: "Human input is required to continue.", updatedAt: "2026-07-11T09:05:00.000Z" }),
  operatorProductRunDetailSchema.parse({ ...base, id: "run-failed", runType: "writeback", status: "failed", displayState: "failed", failureSummary: "Eve reported provider_401.", completedAt: "2026-07-11T09:06:00.000Z", updatedAt: "2026-07-11T09:06:00.000Z", steps: [{ ...base.steps[0]!, status: "failed", failureSummary: "Eve reported provider_401." }] }),
  operatorProductRunDetailSchema.parse({ ...base, id: "run-completed", runType: "signal-capture", status: "completed", displayState: "completed", completedAt: "2026-07-11T09:07:00.000Z", updatedAt: "2026-07-11T09:07:00.000Z" }),
  operatorProductRunDetailSchema.parse({ ...base, id: "run-expired", runType: "owned-docs-work", status: "completed", displayState: "expired", completedAt: "2026-06-01T09:07:00.000Z", expiresAt: "2026-07-01T09:00:00.000Z", updatedAt: "2026-06-01T09:07:00.000Z" }),
];
