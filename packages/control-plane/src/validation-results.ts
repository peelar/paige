import { and, asc, desc, eq, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.js";
import { validationCases, validationRuns } from "./db/schema.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";

const RETENTION_DAYS = 30;
const REDACTION_VERSION = 1;
const text = z.string().trim().min(1);
const iso = z.string().datetime({ offset: true });

export const validationKindSchema = z.enum([
  "live-eval",
  "deterministic-validation",
]);
export const validationOutcomeSchema = z.enum([
  "missing",
  "skipped",
  "flaky",
  "failed",
  "passed",
]);
export const validationAssertionSummarySchema = z
  .object({
    name: text.max(300),
    passed: z.boolean(),
    severity: z.enum(["gate", "soft"]).optional(),
    score: z.number().finite().optional(),
    threshold: z.number().finite().optional(),
    message: z.string().max(500).optional(),
  })
  .strict();
export const startValidationRunInputSchema = z
  .object({
    id: text.max(500),
    kind: validationKindSchema,
    suite: text.max(300),
    target: text.max(1_000),
    model: text.max(300).optional(),
    revision: text.max(300).optional(),
    deployment: text.max(1_000).optional(),
    startedAt: iso,
    artifactReferences: z.array(text.max(1_000)).max(20).default([]),
  })
  .strict();
export const recordValidationCaseInputSchema = z
  .object({
    validationRunId: text,
    caseId: text.max(500),
    name: text.max(500),
    outcome: validationOutcomeSchema,
    assertions: z.array(validationAssertionSummarySchema).max(100).default([]),
    failureSummary: z.string().max(5_000).optional(),
    artifactReference: z.string().max(1_000).optional(),
    startedAt: iso,
    completedAt: iso.optional(),
  })
  .strict();
export const completeValidationRunInputSchema = z
  .object({
    id: text,
    outcome: validationOutcomeSchema,
    completedAt: iso,
    model: text.max(300).optional(),
    revision: text.max(300).optional(),
    deployment: text.max(1_000).optional(),
  })
  .strict();

export const validationCaseSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  name: z.string(),
  outcome: validationOutcomeSchema,
  assertions: z.array(validationAssertionSummarySchema),
  failureSummary: z.string().nullable(),
  artifactReference: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  updatedAt: z.string(),
});
export const validationRunSchema = z.object({
  id: z.string(),
  kind: validationKindSchema,
  suite: z.string(),
  target: z.string(),
  model: z.string().nullable(),
  revision: z.string().nullable(),
  deployment: z.string().nullable(),
  outcome: validationOutcomeSchema,
  redactionVersion: z.literal(REDACTION_VERSION),
  artifactReferences: z.array(z.string()),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  expiresAt: z.string(),
  updatedAt: z.string(),
  cases: z.array(validationCaseSchema),
});
export const validationDisplayOutcomeSchema = z.enum([
  ...validationOutcomeSchema.options,
  "expired",
]);
const validationCaseCountsSchema = z.object({
  missing: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
});
export const operatorValidationRunListItemSchema = validationRunSchema
  .omit({ cases: true })
  .extend({
    displayOutcome: validationDisplayOutcomeSchema,
    caseCounts: validationCaseCountsSchema,
  });
export const validationAssertionComparisonSchema = z.object({
  name: z.string(),
  baseline: validationAssertionSummarySchema.nullable(),
  current: validationAssertionSummarySchema.nullable(),
  change: z.enum([
    "unchanged",
    "added",
    "removed",
    "improved",
    "regressed",
    "weakened",
  ]),
});
export const validationCaseComparisonSchema = z.object({
  caseId: z.string(),
  name: z.string(),
  baselineOutcome: validationOutcomeSchema.nullable(),
  currentOutcome: validationOutcomeSchema.nullable(),
  change: z.enum([
    "unchanged",
    "new",
    "missing",
    "improved",
    "regressed",
    "weakened",
  ]),
  assertions: z.array(validationAssertionComparisonSchema),
});
export const validationAssuranceDetailSchema = z.object({
  run: validationRunSchema,
  baseline: validationRunSchema.nullable(),
  availableBaselines: z.array(operatorValidationRunListItemSchema),
  comparison: z.array(validationCaseComparisonSchema),
});

export type ValidationRun = z.infer<typeof validationRunSchema>;
export type OperatorValidationRunListItem = z.infer<
  typeof operatorValidationRunListItemSchema
>;
export type ValidationAssuranceDetail = z.infer<
  typeof validationAssuranceDetailSchema
>;

export async function startValidationRun(
  input: z.input<typeof startValidationRunInputSchema>,
) {
  const parsed = startValidationRunInputSchema.parse(input);
  const artifactReferences = parsed.artifactReferences.map(redactExcerpt);

  await withDocsAgentDatabase((db) =>
    db
      .insert(validationRuns)
      .values({
        id: parsed.id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: parsed.kind,
        suite: parsed.suite,
        target: redactExcerpt(parsed.target),
        model: parsed.model ?? null,
        revision: parsed.revision ?? null,
        deployment: parsed.deployment ? redactExcerpt(parsed.deployment) : null,
        outcome: "missing",
        redactionVersion: REDACTION_VERSION,
        artifactReferences,
        startedAt: parsed.startedAt,
        completedAt: null,
        durationMs: null,
        expiresAt: addDays(parsed.startedAt, RETENTION_DAYS),
        updatedAt: parsed.startedAt,
      })
      .onConflictDoNothing(),
  );

  const run = await getValidationRun({ id: parsed.id });
  const target = redactExcerpt(parsed.target);
  if (
    run.kind !== parsed.kind ||
    run.suite !== parsed.suite ||
    run.target !== target ||
    run.startedAt !== parsed.startedAt
  ) {
    throw new Error(
      `Validation run identity conflict for ${parsed.id}; use a new stable run id.`,
    );
  }
  return run;
}

export async function recordValidationCase(
  input: z.input<typeof recordValidationCaseInputSchema>,
) {
  const parsed = recordValidationCaseInputSchema.parse(input);
  await requireRun(parsed.validationRunId);
  const id = `${parsed.validationRunId}:${parsed.caseId}`;
  const completedAt = parsed.completedAt ?? null;
  const values = {
    name: redactExcerpt(parsed.name),
    outcome: parsed.outcome,
    assertionSummaries: parsed.assertions.map((item) => ({
      ...item,
      name: redactExcerpt(item.name),
      message: item.message ? redactExcerpt(item.message) : undefined,
    })),
    failureSummary: parsed.failureSummary
      ? redactExcerpt(parsed.failureSummary)
      : null,
    artifactReference: parsed.artifactReference
      ? redactExcerpt(parsed.artifactReference)
      : null,
    startedAt: parsed.startedAt,
    completedAt,
    durationMs: completedAt ? duration(parsed.startedAt, completedAt) : null,
    updatedAt: completedAt ?? parsed.startedAt,
  };

  await withDocsAgentDatabase((db) =>
    db
      .insert(validationCases)
      .values({
        id,
        validationRunId: parsed.validationRunId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        caseId: parsed.caseId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [validationCases.validationRunId, validationCases.caseId],
        set: values,
      }),
  );

  return (await getValidationRun({ id: parsed.validationRunId })).cases.find(
    (item) => item.caseId === parsed.caseId,
  )!;
}

export async function completeValidationRun(
  input: z.input<typeof completeValidationRunInputSchema>,
) {
  const parsed = completeValidationRunInputSchema.parse(input);
  const run = await requireRun(parsed.id);

  await withDocsAgentDatabase((db) =>
    db
      .update(validationRuns)
      .set({
        outcome: parsed.outcome,
        completedAt: parsed.completedAt,
        durationMs: duration(run.startedAt, parsed.completedAt),
        model: parsed.model ?? run.model,
        revision: parsed.revision ?? run.revision,
        deployment: parsed.deployment
          ? redactExcerpt(parsed.deployment)
          : run.deployment,
        updatedAt: parsed.completedAt,
      })
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.id, parsed.id),
        ),
      ),
  );

  return getValidationRun({ id: parsed.id });
}

export async function getValidationRun(input: { id: string }) {
  const id = text.parse(input.id);

  return withDocsAgentDatabase(async (db) => {
    const runs = await db
      .select()
      .from(validationRuns)
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.id, id),
        ),
      )
      .limit(1);
    if (!runs[0]) throw new Error(`Validation run not found: ${id}`);

    const cases = await db
      .select()
      .from(validationCases)
      .where(eq(validationCases.validationRunId, id))
      .orderBy(asc(validationCases.startedAt), asc(validationCases.caseId));
    const run = runs[0];

    return validationRunSchema.parse({
      id: run.id,
      kind: run.kind,
      suite: run.suite,
      target: run.target,
      model: run.model,
      revision: run.revision,
      deployment: run.deployment,
      outcome: run.outcome,
      redactionVersion: run.redactionVersion,
      artifactReferences: run.artifactReferences,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      expiresAt: run.expiresAt,
      updatedAt: run.updatedAt,
      cases: cases.map((item) => ({
        id: item.id,
        caseId: item.caseId,
        name: item.name,
        outcome: item.outcome,
        assertions: item.assertionSummaries,
        failureSummary: item.failureSummary,
        artifactReference: item.artifactReference,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        durationMs: item.durationMs,
        updatedAt: item.updatedAt,
      })),
    });
  });
}

export async function listValidationRuns(
  input: {
    kinds?: Array<z.infer<typeof validationKindSchema>>;
    outcomes?: Array<z.infer<typeof validationDisplayOutcomeSchema>>;
    query?: string;
    now?: string;
    limit?: number;
  } = {},
) {
  const kinds = z.array(validationKindSchema).max(2).parse(input.kinds ?? []);
  const outcomes = z
    .array(validationDisplayOutcomeSchema)
    .max(6)
    .parse(input.outcomes ?? []);
  const query = input.query?.trim().toLowerCase().slice(0, 200) || undefined;
  const now = iso.parse(input.now ?? new Date().toISOString());
  const limit = z.number().int().min(1).max(200).parse(input.limit ?? 100);

  return withDocsAgentDatabase(async (db) => {
    const runs = await db
      .select()
      .from(validationRuns)
      .where(eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID))
      .orderBy(desc(validationRuns.startedAt))
      .limit(500);
    const filtered = runs
      .filter((run) => {
        const displayOutcome = run.expiresAt <= now ? "expired" : run.outcome;
        if (
          kinds.length > 0 &&
          !kinds.includes(validationKindSchema.parse(run.kind))
        ) {
          return false;
        }
        if (
          outcomes.length > 0 &&
          !outcomes.includes(validationDisplayOutcomeSchema.parse(displayOutcome))
        ) {
          return false;
        }
        if (query === undefined) return true;
        return [
          run.id,
          run.suite,
          run.target,
          run.model,
          run.revision,
          run.deployment,
        ]
          .filter((value): value is string => value !== null)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .slice(0, limit);
    if (filtered.length === 0) return [];

    const cases = await db
      .select({
        validationRunId: validationCases.validationRunId,
        outcome: validationCases.outcome,
      })
      .from(validationCases)
      .where(inArray(validationCases.validationRunId, filtered.map((run) => run.id)));
    const counts = new Map<string, ReturnType<typeof emptyCaseCounts>>();
    for (const item of cases) {
      const next = counts.get(item.validationRunId) ?? emptyCaseCounts();
      next[validationOutcomeSchema.parse(item.outcome)] += 1;
      counts.set(item.validationRunId, next);
    }

    return filtered.map((run) => toOperatorRun(run, counts.get(run.id), now));
  });
}

export async function getValidationAssuranceDetail(input: {
  id: string;
  baselineId?: string;
  now?: string;
}) {
  const id = text.parse(input.id);
  const baselineId =
    input.baselineId === undefined ? undefined : text.parse(input.baselineId);
  const now = iso.parse(input.now ?? new Date().toISOString());
  const run = await getValidationRun({ id });

  const candidates = await withDocsAgentDatabase(async (db) => {
    const rows = (await db
      .select()
      .from(validationRuns)
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.kind, run.kind),
          eq(validationRuns.suite, run.suite),
          lt(validationRuns.startedAt, run.startedAt),
        ),
      )
      .orderBy(desc(validationRuns.startedAt))
      .limit(50))
      .filter((row) => targetClass(row.target) === targetClass(run.target))
      .slice(0, 20);
    if (rows.length === 0) return [];
    const cases = await db
      .select({
        validationRunId: validationCases.validationRunId,
        outcome: validationCases.outcome,
      })
      .from(validationCases)
      .where(inArray(validationCases.validationRunId, rows.map((row) => row.id)));
    const counts = new Map<string, ReturnType<typeof emptyCaseCounts>>();
    for (const item of cases) {
      const next = counts.get(item.validationRunId) ?? emptyCaseCounts();
      next[validationOutcomeSchema.parse(item.outcome)] += 1;
      counts.set(item.validationRunId, next);
    }
    return rows.map((row) => toOperatorRun(row, counts.get(row.id), now));
  });
  const selected =
    baselineId === undefined
      ? candidates[0]
      : candidates.find((candidate) => candidate.id === baselineId);
  if (baselineId !== undefined && selected === undefined) {
    throw new Error(
      `Validation baseline ${baselineId} is not an earlier ${run.kind} run for suite ${run.suite}.`,
    );
  }
  const baseline =
    selected === undefined
      ? null
      : await getValidationRun({ id: selected.id });

  return validationAssuranceDetailSchema.parse({
    run,
    baseline,
    availableBaselines: candidates,
    comparison: baseline === null ? [] : compareValidationCases(run, baseline),
  });
}

export async function cleanupExpiredValidationRuns(
  input: { now?: string; limit?: number } = {},
) {
  const now = iso.parse(input.now ?? new Date().toISOString());
  const limit = z.number().int().min(1).max(500).parse(input.limit ?? 100);

  return withDocsAgentDatabase((db) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: validationRuns.id })
        .from(validationRuns)
        .where(
          and(
            eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
            lte(validationRuns.expiresAt, now),
          ),
        )
        .orderBy(asc(validationRuns.expiresAt))
        .limit(limit);
      if (rows.length === 0) return { deleted: 0 };

      await tx
        .delete(validationRuns)
        .where(inArray(validationRuns.id, rows.map((row) => row.id)));
      return { deleted: rows.length };
    }),
  );
}

export function redactValidationExcerpt(value: string) {
  return redactExcerpt(value);
}

async function requireRun(id: string) {
  return withDocsAgentDatabase(async (db) => {
    const rows = await db
      .select()
      .from(validationRuns)
      .where(
        and(
          eq(validationRuns.workspaceId, DEFAULT_WORKSPACE_ID),
          eq(validationRuns.id, id),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error(`Validation run not found: ${id}`);
    return rows[0];
  });
}

function redactExcerpt(value: string) {
  return value
    .slice(0, 2_000)
    .replace(
      /(?:github_pat_|gh[opusr]_|xox[baprs]-|lin_api_)[A-Za-z0-9_-]+/gi,
      "[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(
      /((?:token|secret|password|api[-_]?key)\s*[=:]\s*)\S+/gi,
      "$1[redacted]",
    );
}

function toOperatorRun(
  run: typeof validationRuns.$inferSelect,
  caseCounts = emptyCaseCounts(),
  now: string,
) {
  return operatorValidationRunListItemSchema.parse({
    id: run.id,
    kind: run.kind,
    suite: run.suite,
    target: run.target,
    model: run.model,
    revision: run.revision,
    deployment: run.deployment,
    outcome: run.outcome,
    displayOutcome: run.expiresAt <= now ? "expired" : run.outcome,
    redactionVersion: run.redactionVersion,
    artifactReferences: run.artifactReferences,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    expiresAt: run.expiresAt,
    updatedAt: run.updatedAt,
    caseCounts,
  });
}

function emptyCaseCounts() {
  return { missing: 0, skipped: 0, flaky: 0, failed: 0, passed: 0 };
}

function compareValidationCases(current: ValidationRun, baseline: ValidationRun) {
  const currentById = new Map(current.cases.map((item) => [item.caseId, item]));
  const baselineById = new Map(baseline.cases.map((item) => [item.caseId, item]));
  const ids = [...new Set([...baselineById.keys(), ...currentById.keys()])].sort();

  return ids.map((caseId) => {
    const currentCase = currentById.get(caseId);
    const baselineCase = baselineById.get(caseId);
    const assertions = compareAssertions(
      currentCase?.assertions ?? [],
      baselineCase?.assertions ?? [],
    );
    return validationCaseComparisonSchema.parse({
      caseId,
      name: currentCase?.name ?? baselineCase?.name ?? caseId,
      baselineOutcome: baselineCase?.outcome ?? null,
      currentOutcome: currentCase?.outcome ?? null,
      change: caseChange(currentCase, baselineCase, assertions),
      assertions,
    });
  });
}

function compareAssertions(
  current: z.infer<typeof validationAssertionSummarySchema>[],
  baseline: z.infer<typeof validationAssertionSummarySchema>[],
) {
  const currentByKey = indexAssertions(current);
  const baselineByKey = indexAssertions(baseline);
  const keys = [...new Set([...baselineByKey.keys(), ...currentByKey.keys()])];
  return keys.map((key, index) => {
    const next = currentByKey.get(key) ?? null;
    const prior = baselineByKey.get(key) ?? null;
    return validationAssertionComparisonSchema.parse({
      name: next?.name ?? prior?.name ?? `assertion-${index + 1}`,
      baseline: prior,
      current: next,
      change: assertionChange(next, prior),
    });
  });
}

function indexAssertions(
  assertions: z.infer<typeof validationAssertionSummarySchema>[],
) {
  const occurrences = new Map<string, number>();
  return new Map(
    assertions.map((assertion) => {
      const occurrence = occurrences.get(assertion.name) ?? 0;
      occurrences.set(assertion.name, occurrence + 1);
      return [`${assertion.name}:${occurrence}`, assertion] as const;
    }),
  );
}

function assertionChange(
  current: z.infer<typeof validationAssertionSummarySchema> | null,
  baseline: z.infer<typeof validationAssertionSummarySchema> | null,
) {
  if (baseline === null) return "added";
  if (current === null) return "removed";
  if (
    (baseline.severity === "gate" && current.severity === "soft") ||
    (baseline.threshold !== undefined &&
      (current.threshold === undefined || current.threshold < baseline.threshold))
  ) {
    return "weakened";
  }
  if (baseline.passed && !current.passed) return "regressed";
  if (!baseline.passed && current.passed) return "improved";
  return "unchanged";
}

function caseChange(
  current: ValidationRun["cases"][number] | undefined,
  baseline: ValidationRun["cases"][number] | undefined,
  assertions: z.infer<typeof validationAssertionComparisonSchema>[],
) {
  if (baseline === undefined) return "new";
  if (current === undefined) return "missing";
  if (
    assertions.some(
      (item) => item.change === "weakened" || item.change === "removed",
    )
  ) {
    return "weakened";
  }
  const rank = { missing: 0, failed: 1, skipped: 2, flaky: 3, passed: 4 } as const;
  if (rank[current.outcome] < rank[baseline.outcome]) return "regressed";
  if (rank[current.outcome] > rank[baseline.outcome]) return "improved";
  return "unchanged";
}

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}

function duration(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function targetClass(target: string) {
  return target.split(":", 1)[0] ?? target;
}
