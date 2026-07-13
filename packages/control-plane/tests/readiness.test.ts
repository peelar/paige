import assert from "node:assert/strict";

import {
  collectReadinessReport,
  readinessItemIdSchema,
  type ReadinessDependencies,
  type ReadinessItemId,
  type ReadinessObservation,
  type ReadinessState,
} from "../src/readiness.ts";
import { test } from "vitest";

test("readiness", async () => {
const checkedAt = new Date("2026-07-11T12:00:00.000Z");
const stateCases: Array<{
  expected: ReadinessState;
  observation: ReadinessObservation;
}> = [
  {
    expected: "configured",
    observation: baseObservation({ configured: true }),
  },
  {
    expected: "reachable",
    observation: baseObservation({ configured: true, reachable: true }),
  },
  {
    expected: "verified",
    observation: baseObservation({ configured: true, reachable: true, verified: true, ready: true }),
  },
  {
    expected: "blocked",
    observation: baseObservation({ blockedReason: "Known requirement failed." }),
  },
  {
    expected: "unknown",
    observation: baseObservation({ configured: null, reachable: null, verified: null }),
  },
];

for (const id of readinessItemIdSchema.options) {
  let activeObservation = stateCases[0]!.observation;
  const dependencies = dependenciesWith(async (probeId) => {
    return probeId === id ? activeObservation : verifiedObservation();
  });

  for (const stateCase of stateCases) {
    activeObservation = stateCase.observation;
    const report = await collectReadinessReport(dependencies);
    const item = report.items.find((candidate) => candidate.id === id);
    assert.equal(item?.state, stateCase.expected, `${id} should enter ${stateCase.expected}`);
    assert.equal(item?.lastCheckedAt, checkedAt.toISOString());
    if (stateCase.expected === "blocked" || stateCase.expected === "unknown") {
      assert.notEqual(item?.ready, true);
    }
  }

  const failed = await collectReadinessReport(
    dependenciesWith(async (probeId) => {
      if (probeId === id) throw new Error(`${id} provider is down`);
      return verifiedObservation();
    }),
  );
  const failedItem = failed.items.find((candidate) => candidate.id === id);
  assert.equal(failedItem?.state, "blocked");
  assert.match(failedItem?.summary ?? "", /provider is down/);
  assert.notEqual(failedItem?.nextAction, null);
}

const ready = await collectReadinessReport(
  dependenciesWith(async () => verifiedObservation()),
);
assert.equal(ready.overall, "ready");

const attention = await collectReadinessReport(
  dependenciesWith(async (id) => {
    return id === "slack"
      ? baseObservation({ configured: null, reachable: null, verified: null })
      : verifiedObservation();
  }),
);
assert.equal(attention.overall, "attention");

const blockedReport = await collectReadinessReport(
  dependenciesWith(async (id) => {
    return id === "database"
      ? baseObservation({ blockedReason: "Database is down." })
      : verifiedObservation();
  }),
);
assert.equal(blockedReport.overall, "blocked");

console.log("Readiness service checks passed.");

function dependenciesWith(
  observationFor: (id: ReadinessItemId) => Promise<ReadinessObservation>,
): ReadinessDependencies {
  return {
    now: () => checkedAt,
    probes: Object.fromEntries(
      readinessItemIdSchema.options.map((id) => [id, () => observationFor(id)]),
    ) as Record<ReadinessItemId, () => Promise<ReadinessObservation>>,
  };
}

function baseObservation(
  input: Partial<ReadinessObservation>,
): ReadinessObservation {
  return {
    ready: false,
    summary: "Readiness observation.",
    source: "Table-driven service check",
    nextAction: "Complete the next verification action.",
    ...input,
  };
}

function verifiedObservation(): ReadinessObservation {
  return baseObservation({
    configured: true,
    reachable: true,
    verified: true,
    ready: true,
    nextAction: null,
  });
}
});
