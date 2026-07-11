import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDocsAgentDatabase } from "../agent/lib/db/client.js";
import {
  assertDocsSignalTransitionAllowed,
  docsSignalStatuses,
  docsSignalTransitionAuthorities,
  docsSignalTransitionPolicy,
  DocsSignalTransitionError,
  type DocsSignalStatus,
  type DocsSignalTransitionAuthority,
} from "../agent/lib/docs-signal-lifecycle.js";
import {
  createDocsSignal,
  createDocsSignalInputSchema,
  getDocsSignal,
  transitionDocsSignalLifecycle,
  updateDocsSignalLifecycle,
  updateDocsSignalLifecycleInputSchema,
} from "../agent/lib/docs-signals.js";

const expectedTransitions = [
  "intake:captured->captured",
  "intake:captured->needs-maintainer-answer",
  "intake:captured->needs-source-evidence",
  "intake:captured->verification-skipped",
  "intake:captured->docs-verified",
  "intake:captured->closed-already-covered",
  "intake:captured->closed-not-docs-relevant",
  "triage:captured->captured",
  "triage:captured->needs-maintainer-answer",
  "triage:captured->needs-source-evidence",
  "triage:needs-maintainer-answer->captured",
  "triage:needs-maintainer-answer->needs-maintainer-answer",
  "triage:needs-maintainer-answer->needs-source-evidence",
  "triage:needs-source-evidence->captured",
  "triage:needs-source-evidence->needs-maintainer-answer",
  "triage:needs-source-evidence->needs-source-evidence",
  "triage:verification-skipped->captured",
  "verification:captured->docs-verified",
  "verification:docs-verified->docs-verified",
  "patch-handoff:docs-verified->patch-failed",
  "patch-handoff:docs-verified->patch-prepared",
  "patch-handoff:docs-verified->closed-already-covered",
  "patch-handoff:patch-failed->patch-failed",
  "patch-handoff:patch-failed->patch-prepared",
  "patch-handoff:patch-failed->closed-already-covered",
  "writeback:patch-prepared->draft-pr-opened",
].sort();

const actualTransitions = docsSignalTransitionAuthorities.flatMap((authority) =>
  Object.entries(docsSignalTransitionPolicy[authority]).flatMap(([from, targets]) =>
    targets.map((to) => transitionKey(authority, from as DocsSignalStatus, to)),
  ),
).sort();
assert.deepEqual(actualTransitions, expectedTransitions);

const expectedTransitionSet = new Set(expectedTransitions);
for (const authority of docsSignalTransitionAuthorities) {
  for (const from of docsSignalStatuses) {
    for (const to of docsSignalStatuses) {
      const input = { authority, from, to };
      if (expectedTransitionSet.has(transitionKey(authority, from, to))) {
        assert.doesNotThrow(() => assertDocsSignalTransitionAllowed(input));
      } else {
        assert.throws(
          () => assertDocsSignalTransitionAllowed(input),
          DocsSignalTransitionError,
        );
      }
    }
  }
}

const signalInput = {
  source: { kind: "manual-scenario" as const },
  sourceSummary: "Lifecycle state-machine test signal.",
};
assert.equal(
  createDocsSignalInputSchema.safeParse({
    ...signalInput,
    status: "patch-prepared",
  }).success,
  false,
);
assert.equal(
  updateDocsSignalLifecycleInputSchema.safeParse({
    id: "signal-id",
    status: "patch-prepared",
    reason: "Attempt to forge a prepared patch.",
  }).success,
  false,
);
assert.equal(
  updateDocsSignalLifecycleInputSchema.safeParse({
    id: "signal-id",
    status: "captured",
    reason: "Attempt to forge an internal actor.",
    actor: "docs-agent:github-writeback",
  }).success,
  false,
);

const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-lifecycle-"));
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "signals.sqlite")}`;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();

  let triageSignal = await createSignal("triage");
  triageSignal = await updateDocsSignalLifecycle({
    id: triageSignal.id,
    status: "needs-source-evidence",
    reason: "A source commit or release note is still required.",
    missingEvidence: ["Source commit or release note."],
  });
  assert.equal(triageSignal.status, "needs-source-evidence");
  assert.equal(triageSignal.events[0]?.actor, "docs-agent:lifecycle-tool");

  const triageEventCount = triageSignal.events.length;
  await assert.rejects(
    () => updateDocsSignalLifecycle({
      id: triageSignal.id,
      status: "patch-prepared" as never,
      reason: "Attempt to forge a privileged state.",
    }),
    /Invalid option|Invalid input/,
  );
  triageSignal = await getDocsSignal({ id: triageSignal.id });
  assert.equal(triageSignal.status, "needs-source-evidence");
  assert.equal(triageSignal.events.length, triageEventCount);

  triageSignal = await updateDocsSignalLifecycle({
    id: triageSignal.id,
    status: "captured",
    reason: "Required source evidence was attached for later verification.",
    missingEvidence: [],
  });
  assert.equal(triageSignal.status, "captured");
  assert.deepEqual(triageSignal.missingEvidence, []);

  const evidenceBlocked = await createDocsSignal({
    source: {
      kind: "manual-scenario",
      provider: "lifecycle-test",
      providerId: "evidence-blocked",
    },
    sourceSummary: "Captured signal whose source evidence is incomplete.",
    missingEvidence: ["A source commit is still required."],
  });
  await assert.rejects(
    () => transitionDocsSignalLifecycle({
      id: evidenceBlocked.signal.id,
      status: "docs-verified",
      reason: "Attempted verification without source evidence.",
      actor: "docs-agent:current-docs-verification",
    }, "verification"),
    /requires source evidence to be complete/,
  );
  const unchangedEvidenceBlocked = await getDocsSignal({ id: evidenceBlocked.signal.id });
  assert.equal(unchangedEvidenceBlocked.status, "captured");
  assert.equal(unchangedEvidenceBlocked.events.length, 1);

  let workflowSignal = await createSignal("workflow");
  const initialWorkflowEventCount = workflowSignal.events.length;
  await assert.rejects(
    () => transitionDocsSignalLifecycle({
      id: workflowSignal.id,
      status: "patch-prepared",
      reason: "Wrong owner attempted to prepare a patch.",
      actor: "docs-agent:test",
    }, "triage"),
    DocsSignalTransitionError,
  );
  workflowSignal = await getDocsSignal({ id: workflowSignal.id });
  assert.equal(workflowSignal.status, "captured");
  assert.equal(workflowSignal.events.length, initialWorkflowEventCount);

  workflowSignal = await transitionDocsSignalLifecycle({
    id: workflowSignal.id,
    status: "docs-verified",
    reason: "Current docs verification completed.",
    actor: "docs-agent:current-docs-verification",
  }, "verification");
  await assert.rejects(
    () => updateDocsSignalLifecycle({
      id: workflowSignal.id,
      status: "needs-maintainer-answer",
      reason: "Generic triage cannot reopen verified work.",
    }),
    DocsSignalTransitionError,
  );
  workflowSignal = await transitionDocsSignalLifecycle({
    id: workflowSignal.id,
    status: "patch-failed",
    reason: "The first patch attempt failed its checks.",
    actor: "docs-agent:signal-patch-handoff",
  }, "patch-handoff");
  workflowSignal = await transitionDocsSignalLifecycle({
    id: workflowSignal.id,
    status: "patch-prepared",
    reason: "The retry produced a checked patch.",
    actor: "docs-agent:signal-patch-handoff",
  }, "patch-handoff");

  const preparedEventCount = workflowSignal.events.length;
  await assert.rejects(
    () => updateDocsSignalLifecycle({
      id: workflowSignal.id,
      status: "captured",
      reason: "Generic triage cannot reopen a prepared patch.",
    }),
    DocsSignalTransitionError,
  );
  workflowSignal = await getDocsSignal({ id: workflowSignal.id });
  assert.equal(workflowSignal.status, "patch-prepared");
  assert.equal(workflowSignal.events.length, preparedEventCount);

  workflowSignal = await transitionDocsSignalLifecycle({
    id: workflowSignal.id,
    status: "draft-pr-opened",
    reason: "Approved writeback opened a draft PR.",
    actor: "docs-agent:github-writeback",
  }, "writeback");
  assert.deepEqual(
    workflowSignal.events.slice(0, 4).map(({ fromStatus, toStatus }) => ({
      fromStatus,
      toStatus,
    })),
    [
      { fromStatus: "patch-prepared", toStatus: "draft-pr-opened" },
      { fromStatus: "patch-failed", toStatus: "patch-prepared" },
      { fromStatus: "docs-verified", toStatus: "patch-failed" },
      { fromStatus: "captured", toStatus: "docs-verified" },
    ],
  );
  await assertCannotReopen(workflowSignal.id, "draft-pr-opened");

  for (const closedStatus of [
    "closed-already-covered",
    "closed-not-docs-relevant",
  ] as const) {
    let closedSignal = await createSignal(closedStatus);
    closedSignal = await transitionDocsSignalLifecycle({
      id: closedSignal.id,
      status: closedStatus,
      reason: `Intake closed the signal as ${closedStatus}.`,
      actor: "docs-agent:test-intake",
    }, "intake");
    await assertCannotReopen(closedSignal.id, closedStatus);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Docs signal lifecycle checks passed.");

function transitionKey(
  authority: DocsSignalTransitionAuthority,
  from: DocsSignalStatus,
  to: DocsSignalStatus,
): string {
  return `${authority}:${from}->${to}`;
}

async function createSignal(label: string) {
  const result = await createDocsSignal({
    source: {
      kind: "manual-scenario",
      provider: "lifecycle-test",
      providerId: label,
    },
    sourceSummary: `Lifecycle state-machine test signal: ${label}.`,
  });
  assert.equal(result.created, true);
  assert.equal(result.signal.status, "captured");
  return result.signal;
}

async function assertCannotReopen(
  signalId: string,
  expectedStatus: DocsSignalStatus,
): Promise<void> {
  const eventCount = (await getDocsSignal({ id: signalId })).events.length;

  for (const authority of docsSignalTransitionAuthorities) {
    await assert.rejects(
      () => transitionDocsSignalLifecycle({
        id: signalId,
        status: "captured",
        reason: `Attempt to reopen through ${authority}.`,
        actor: "docs-agent:test",
      }, authority),
      DocsSignalTransitionError,
    );
  }

  const unchanged = await getDocsSignal({ id: signalId });
  assert.equal(unchanged.status, expectedStatus);
  assert.equal(unchanged.events.length, eventCount);
}
