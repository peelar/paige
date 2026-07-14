import assert from "node:assert/strict";

import { test } from "vitest";

import { watchContinuityContextSchema } from "@docs-agent/control-plane/agent";
import { scopeWatchInternalDocumentInput } from "../agent/tools/internal_document";

const WATCH_ID = "11111111-1111-4111-8111-111111111177";
const REVISION_ID = "22222222-2222-4222-8222-222222222277";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333377";
const RESERVATION_ID = "7".repeat(64);

test("watch document operations stay on continuity and retain server provenance", () => {
  const continuity = resolvedContinuity();
  const scoped = scopeWatchInternalDocumentInput({
    mode: "update",
    documentId: DOCUMENT_ID,
    expectedRevision: 3,
    content: "# Evidence\n\nThe release is confirmed.",
    changeSummary: "Replace the superseded hypothesis.",
    sourceReferences: [
      { kind: "release", id: "v3.0.0" },
      { kind: "watch-occurrence", id: RESERVATION_ID },
    ],
  }, continuity);
  assert.equal(scoped.mode, "update");
  assert.deepEqual(scoped.sourceReferences, [
    { kind: "policy-bound-watch", id: WATCH_ID },
    { kind: "watch-effective-revision", id: REVISION_ID },
    { kind: "watch-occurrence", id: RESERVATION_ID },
    { kind: "release", id: "v3.0.0" },
  ]);

  const found = scopeWatchInternalDocumentInput({
    mode: "find",
    attachment: {
      resourceType: "policy-bound-watch",
      resourceId: "44444444-4444-4444-8444-444444444444",
      relationship: "continuity",
    },
  }, continuity);
  assert.deepEqual(found, {
    mode: "find",
    attachment: {
      resourceType: "policy-bound-watch",
      resourceId: WATCH_ID,
      relationship: "continuity",
    },
  });

  assert.throws(
    () => scopeWatchInternalDocumentInput({
      mode: "read",
      documentId: "55555555-5555-4555-8555-555555555555",
    }, continuity),
    /only its attached continuity document/u,
  );
  assert.throws(
    () => scopeWatchInternalDocumentInput({
      mode: "archive",
      documentId: DOCUMENT_ID,
      expectedRevision: 3,
      reason: "Archive during an active occurrence.",
      sourceReferences: [],
    }, continuity),
    /cannot archive/u,
  );
});

function resolvedContinuity() {
  const parsed = watchContinuityContextSchema.parse({
    runtime: {
      reservationId: RESERVATION_ID,
      watchId: WATCH_ID,
      effectiveRevisionId: REVISION_ID,
      providerWorkspaceId: "T-DOCS",
      source: {
        provider: "slack",
        providerWorkspaceId: "T-DOCS",
        resource: { type: "channel", id: "C-DOCS" },
      },
      goal: "Preserve durable release findings.",
      trigger: { type: "on_event" },
      evaluation: { mode: "per_event" },
      delivery: { mode: "silent" },
      capabilityGrants: ["docs_work.manage"],
      deliveriesPerDay: 0,
      auditRetentionDays: 30,
      expiresAt: "2026-08-15T00:00:00.000Z",
    },
    document: {
      id: DOCUMENT_ID,
      title: "Watch continuity",
      kind: "watch-continuity",
      editingProfile: "living-summary",
      lifecycleState: "active",
      currentRevision: 3,
      selectedRevision: null,
      content: "# Evidence\n\nThe release is still a hypothesis.",
      retentionExpiresAt: "2026-08-14T00:00:00.000Z",
      archivedAt: null,
      expiredAt: null,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T01:00:00.000Z",
      attachments: [],
      revisions: [],
    },
  });
  if (parsed.document === null) throw new Error("Expected a continuity document.");
  return { ...parsed, document: parsed.document };
}
