import "server-only";

import {
  getValidationAssuranceDetail,
  listValidationRuns,
  operatorValidationRunListItemSchema,
  validationAssuranceDetailSchema,
  type OperatorValidationRunListItem,
  type ValidationAssuranceDetail,
} from "@docs-agent/control-plane";

const TEST_ENV = "DOCS_AGENT_ASSURANCE_TEST_SCENARIOS";

export type AssuranceFilters = {
  kind?: OperatorValidationRunListItem["kind"];
  outcome?: OperatorValidationRunListItem["displayOutcome"];
  query?: string;
};
export type AssuranceListResult =
  | { state: "ready"; runs: OperatorValidationRunListItem[] }
  | { state: "loading" | "empty" | "invalid-record" | "unauthorized" | "database-error" };
export type AssuranceDetailResult =
  | { state: "ready"; detail: ValidationAssuranceDetail }
  | {
      state:
        | "missing"
        | "baseline-invalid"
        | "invalid-record"
        | "unauthorized"
        | "database-error";
    };

export async function resolveAssuranceList(
  filters: AssuranceFilters,
  scenario?: string,
): Promise<AssuranceListResult> {
  if (process.env[TEST_ENV] === "1") {
    if (scenario === "loading") return { state: "loading" };
    if (scenario === "empty") return { state: "empty" };
    if (scenario === "invalid-record") return { state: "invalid-record" };
    if (scenario === "unauthorized") return { state: "unauthorized" };
    if (scenario === "database-error") return { state: "database-error" };
    const runs = fixtureRuns.filter((run) => matches(run, filters));
    return runs.length === 0 ? { state: "empty" } : { state: "ready", runs };
  }

  try {
    const runs = await listValidationRuns({
      kinds: filters.kind === undefined ? [] : [filters.kind],
      outcomes: filters.outcome === undefined ? [] : [filters.outcome],
      query: filters.query,
    });
    return runs.length === 0 ? { state: "empty" } : { state: "ready", runs };
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return { state: "invalid-record" };
    }
    if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) {
      return { state: "unauthorized" };
    }
    return { state: "database-error" };
  }
}

export async function resolveAssuranceDetail(
  id: string,
  baselineId?: string,
  scenario?: string,
): Promise<AssuranceDetailResult> {
  if (process.env[TEST_ENV] === "1") {
    if (scenario === "missing") return { state: "missing" };
    if (scenario === "baseline-invalid") return { state: "baseline-invalid" };
    if (scenario === "invalid-record") return { state: "invalid-record" };
    if (scenario === "unauthorized") return { state: "unauthorized" };
    if (scenario === "database-error") return { state: "database-error" };
    if (id.includes("%")) return { state: "missing" };
    const selectedBaseline = baselineId === "live-baseline-older"
      ? olderBaseline
      : baseline;
    return {
      state: "ready",
      detail: validationAssuranceDetailSchema.parse({
        ...fixtureDetail,
        baseline: selectedBaseline,
      }),
    };
  }

  try {
    return {
      state: "ready",
      detail: await getValidationAssuranceDetail({ id, baselineId }),
    };
  } catch (error) {
    if (error instanceof Error && /not an earlier/i.test(error.message)) {
      return { state: "baseline-invalid" };
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return { state: "missing" };
    }
    if (error instanceof Error && error.name === "ZodError") {
      return { state: "invalid-record" };
    }
    if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) {
      return { state: "unauthorized" };
    }
    return { state: "database-error" };
  }
}

function matches(run: OperatorValidationRunListItem, filters: AssuranceFilters) {
  if (filters.kind !== undefined && run.kind !== filters.kind) return false;
  if (filters.outcome !== undefined && run.displayOutcome !== filters.outcome) {
    return false;
  }
  if (filters.query === undefined) return true;
  const query = filters.query.toLowerCase();
  return [run.id, run.suite, run.target, run.model, run.revision, run.deployment]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

const fixtureBase = {
  target: "local:http://127.0.0.1:2000",
  model: "openai/gpt-5.4",
  revision: "ac09165",
  deployment: null,
  redactionVersion: 1 as const,
  artifactReferences: [] as string[],
  startedAt: "2026-07-11T18:00:00.000Z",
  completedAt: "2026-07-11T18:04:12.000Z",
  durationMs: 252_000,
  expiresAt: "2026-08-10T18:00:00.000Z",
  updatedAt: "2026-07-11T18:04:12.000Z",
  caseCounts: { missing: 0, skipped: 0, flaky: 0, failed: 0, passed: 8 },
};

const fixtureRuns: OperatorValidationRunListItem[] = [
  operatorValidationRunListItemSchema.parse({
    ...fixtureBase,
    id: "live-current",
    kind: "live-eval",
    suite: "docs-agent",
    outcome: "failed",
    displayOutcome: "failed",
    caseCounts: { missing: 1, skipped: 0, flaky: 1, failed: 1, passed: 5 },
  }),
  operatorValidationRunListItemSchema.parse({
    ...fixtureBase,
    id: "deterministic-passed",
    kind: "deterministic-validation",
    suite: "pnpm-check",
    target: "workspace:main",
    model: null,
    outcome: "passed",
    displayOutcome: "passed",
    durationMs: 95_700,
    caseCounts: { missing: 0, skipped: 0, flaky: 0, failed: 0, passed: 4 },
  }),
  operatorValidationRunListItemSchema.parse({
    ...fixtureBase,
    id: "live-flaky",
    kind: "live-eval",
    suite: "editorial-interventions",
    outcome: "flaky",
    displayOutcome: "flaky",
    caseCounts: { missing: 0, skipped: 0, flaky: 2, failed: 0, passed: 6 },
  }),
  operatorValidationRunListItemSchema.parse({
    ...fixtureBase,
    id: "live-skipped",
    kind: "live-eval",
    suite: "workspace-memory",
    outcome: "skipped",
    displayOutcome: "skipped",
    caseCounts: { missing: 0, skipped: 2, flaky: 0, failed: 0, passed: 0 },
  }),
  operatorValidationRunListItemSchema.parse({
    ...fixtureBase,
    id: "live-missing",
    kind: "live-eval",
    suite: "slack-participation",
    completedAt: null,
    durationMs: null,
    outcome: "missing",
    displayOutcome: "missing",
    caseCounts: { missing: 1, skipped: 0, flaky: 0, failed: 0, passed: 0 },
  }),
  operatorValidationRunListItemSchema.parse({
    ...fixtureBase,
    id: "deterministic-expired",
    kind: "deterministic-validation",
    suite: "pnpm-check",
    target: "workspace:main",
    model: null,
    outcome: "passed",
    displayOutcome: "expired",
    startedAt: "2026-05-01T10:00:00.000Z",
    completedAt: "2026-05-01T10:01:31.000Z",
    expiresAt: "2026-05-31T10:00:00.000Z",
    caseCounts: { missing: 0, skipped: 0, flaky: 0, failed: 0, passed: 4 },
  }),
];

const runCases = [
  {
    id: "live-current:docs-impact-patch",
    caseId: "docs-impact/patch",
    name: "Docs impact recommends the smallest evidence-backed patch",
    outcome: "failed" as const,
    assertions: [
      { name: "succeeded", passed: true, severity: "gate" as const, score: 1 },
      { name: "calledTool", passed: false, severity: "gate" as const, score: 0 },
    ],
    failureSummary: "Assertions did not pass: calledTool.",
    artifactReference: "eve://evals/docs-impact/patch",
    startedAt: "2026-07-11T18:00:01.000Z",
    completedAt: "2026-07-11T18:00:42.000Z",
    durationMs: 41_000,
    updatedAt: "2026-07-11T18:00:42.000Z",
  },
  {
    id: "live-current:slack-participation",
    caseId: "slack/participation",
    name: "Invited Slack thread participation stays scoped",
    outcome: "passed" as const,
    assertions: [
      { name: "succeeded", passed: true, severity: "gate" as const, score: 1 },
      { name: "usedNoTools", passed: true, severity: "gate" as const, score: 1 },
    ],
    failureSummary: null,
    artifactReference: null,
    startedAt: "2026-07-11T18:00:43.000Z",
    completedAt: "2026-07-11T18:01:10.000Z",
    durationMs: 27_000,
    updatedAt: "2026-07-11T18:01:10.000Z",
  },
  {
    id: "live-current:memory-lifecycle",
    caseId: "workspace-memory/lifecycle",
    name: "Workspace memory keeps proposal and promotion separate",
    outcome: "missing" as const,
    assertions: [],
    failureSummary: "The eval did not report completion.",
    artifactReference: null,
    startedAt: "2026-07-11T18:01:11.000Z",
    completedAt: null,
    durationMs: null,
    updatedAt: "2026-07-11T18:01:11.000Z",
  },
];

const baseline = validationAssuranceDetailSchema.shape.run.parse({
  ...fixtureBase,
  id: "live-baseline",
  kind: "live-eval",
  suite: "docs-agent",
  outcome: "passed",
  startedAt: "2026-07-10T18:00:00.000Z",
  completedAt: "2026-07-10T18:03:58.000Z",
  expiresAt: "2026-08-09T18:00:00.000Z",
  cases: runCases.map((item) => ({
    ...item,
    id: `live-baseline:${item.caseId}`,
    outcome: "passed",
    failureSummary: null,
    completedAt: "2026-07-10T18:01:00.000Z",
    assertions: item.assertions.length === 0
      ? [{ name: "succeeded", passed: true, severity: "gate", score: 1 }]
      : item.assertions.map((assertion) => ({ ...assertion, passed: true, score: 1 })),
  })),
});

const olderBaseline = validationAssuranceDetailSchema.shape.run.parse({
  ...baseline,
  id: "live-baseline-older",
  revision: "827ac31",
  startedAt: "2026-07-09T18:00:00.000Z",
  completedAt: "2026-07-09T18:04:20.000Z",
  expiresAt: "2026-08-08T18:00:00.000Z",
});

const fixtureDetail = validationAssuranceDetailSchema.parse({
  run: {
    ...fixtureBase,
    id: "live-current",
    kind: "live-eval",
    suite: "docs-agent",
    outcome: "failed",
    artifactReferences: ["eve://evals/2026-07-11/docs-agent"],
    cases: runCases,
  },
  baseline,
  availableBaselines: [
    operatorValidationRunListItemSchema.parse({
      ...fixtureBase,
      ...baseline,
      displayOutcome: "passed",
      caseCounts: { missing: 0, skipped: 0, flaky: 0, failed: 0, passed: 3 },
    }),
    operatorValidationRunListItemSchema.parse({
      ...fixtureBase,
      ...olderBaseline,
      displayOutcome: "passed",
      caseCounts: { missing: 0, skipped: 0, flaky: 0, failed: 0, passed: 3 },
    }),
  ],
  comparison: [
    {
      caseId: "docs-impact/patch",
      name: "Docs impact recommends the smallest evidence-backed patch",
      baselineOutcome: "passed",
      currentOutcome: "failed",
      change: "regressed",
      assertions: [
        { name: "succeeded", baseline: baseline.cases[0]?.assertions[0], current: runCases[0]?.assertions[0], change: "unchanged" },
        { name: "calledTool", baseline: baseline.cases[0]?.assertions[1], current: runCases[0]?.assertions[1], change: "regressed" },
      ],
    },
    {
      caseId: "slack/participation",
      name: "Invited Slack thread participation stays scoped",
      baselineOutcome: "passed",
      currentOutcome: "passed",
      change: "unchanged",
      assertions: [],
    },
    {
      caseId: "workspace-memory/lifecycle",
      name: "Workspace memory keeps proposal and promotion separate",
      baselineOutcome: "passed",
      currentOutcome: "missing",
      change: "weakened",
      assertions: [
        { name: "succeeded", baseline: baseline.cases[2]?.assertions[0], current: null, change: "removed" },
      ],
    },
  ],
});
