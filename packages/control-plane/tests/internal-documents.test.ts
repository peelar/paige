import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { test } from "vitest";

import {
  archiveInternalDocument,
  attachInternalDocument,
  createInternalDocument,
  findInternalDocumentByAttachment,
  INTERNAL_DOCUMENT_MAX_CONTENT_BYTES,
  INTERNAL_DOCUMENT_MAX_REVISIONS,
  InternalDocumentError,
  readInternalDocument,
  updateInternalDocument,
} from "../src/internal-documents.ts";
import {
  migrateDocsAgentDatabase,
  withDocsAgentDatabase,
} from "../src/db/client.ts";
import {
  internalDocumentAttachments,
  internalDocuments,
  policyBoundWatches,
} from "../src/db/schema.ts";
import { DEFAULT_WORKSPACE_ID } from "../src/setup-state.ts";

test("internal working documents", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-internal-documents-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "documents.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;

  const baseNow = new Date("2026-07-14T12:00:00.000Z");
  const watchId = randomUUID();
  const concurrentWatchId = randomUUID();

  try {
    await migrateDocsAgentDatabase();
    await seedWatch(watchId, "active");
    await seedWatch(concurrentWatchId, "paused");

    await assert.rejects(
      createInternalDocument(
        documentInput("Unauthorized"),
        { actor: { type: "agent", id: "paige-agent" } },
      ),
      (error) => hasCode(error, "unauthorized"),
    );

    const attachment = watchAttachment(watchId);
    const created = await createInternalDocument(
      {
        ...documentInput("Release continuity"),
        content: "# Current state\n\nThe public change is still a hypothesis.",
        attachment,
        sourceReferences: [{
          kind: "watch-occurrence",
          id: "occurrence-1",
          url: "https://example.com/evidence/1",
        }],
      },
      command("create-release-continuity", "session-a", "run-a", baseNow),
    );
    assert.equal(created.created, true);
    assert.equal(created.document.currentRevision, 1);
    assert.equal(created.document.lifecycleState, "active");
    assert.equal(created.document.attachments.length, 1);
    assert.deepEqual(created.document.revisions[0]?.sourceReferences, [{
      kind: "watch-occurrence",
      id: "occurrence-1",
      url: "https://example.com/evidence/1",
    }]);
    assert.deepEqual(created.document.revisions[0]?.actor, {
      type: "agent",
      id: "paige-agent",
    });

    const replayedCreate = await createInternalDocument(
      documentInput("Ignored replay input"),
      command("create-release-continuity", "session-a", "run-a", baseNow),
    );
    assert.equal(replayedCreate.replayed, true);
    assert.equal(replayedCreate.document.id, created.document.id);

    const duplicateRelationship = await createInternalDocument(
      {
        ...documentInput("Duplicate relationship"),
        attachment,
      },
      command("duplicate-relationship", "session-b", "run-b", baseNow),
    );
    assert.equal(duplicateRelationship.created, false);
    assert.equal(duplicateRelationship.document.id, created.document.id);

    const found = await findInternalDocumentByAttachment(
      { attachment },
      command("find-release-continuity", "session-b", "run-find", baseNow),
    );
    assert.equal(found?.id, created.document.id);

    const updated = await updateInternalDocument(
      {
        documentId: created.document.id,
        expectedRevision: 1,
        content: "# Current state\n\nRelease evidence now confirms the public change.",
        changeSummary: "Replaced the hypothesis with the verified conclusion.",
        sourceReferences: [{ kind: "release", id: "v2.4.0" }],
      },
      command("confirm-release", "session-b", "run-update", baseNow),
    );
    assert.equal(updated.document.currentRevision, 2);
    assert.equal(updated.document.revisions[1]?.sessionId, "session-b");
    assert.equal(updated.document.revisions[1]?.runId, "run-update");
    assert.match(updated.document.content ?? "", /confirms the public change/);

    const firstRevision = await readInternalDocument(
      { documentId: created.document.id, revision: 1 },
      command("read-first-revision", "session-c", "run-read", baseNow),
    );
    assert.match(firstRevision.content ?? "", /still a hypothesis/);
    assert.equal(firstRevision.selectedRevision, 1);

    const replayedUpdate = await updateInternalDocument(
      {
        documentId: created.document.id,
        expectedRevision: 1,
        content: "This replay input must not create another revision.",
        changeSummary: "Replay.",
        sourceReferences: [],
      },
      command("confirm-release", "session-b", "run-update", baseNow),
    );
    assert.equal(replayedUpdate.replayed, true);
    assert.equal(replayedUpdate.document.currentRevision, 2);

    await assert.rejects(
      updateInternalDocument(
        {
          documentId: created.document.id,
          expectedRevision: 1,
          content: "Stale replacement.",
          changeSummary: "Stale update.",
          sourceReferences: [],
        },
        command("stale-update", "session-c", "run-stale", baseNow),
      ),
      (error) => hasCode(error, "concurrent-update"),
    );

    const concurrentlyEdited = await createInternalDocument(
      documentInput("Concurrent edits"),
      command("create-concurrent-edits", "session-a", "run-concurrent-edits", baseNow),
    );
    const editResults = await Promise.allSettled([
      updateInternalDocument({
        documentId: concurrentlyEdited.document.id,
        expectedRevision: 1,
        content: "# Current state\n\nConcurrent edit A succeeded.",
        changeSummary: "Apply concurrent edit A.",
        sourceReferences: [{ kind: "watch-occurrence", id: "occurrence-a" }],
      }, command("concurrent-edit-a", "session-a", "run-edit-a", baseNow)),
      updateInternalDocument({
        documentId: concurrentlyEdited.document.id,
        expectedRevision: 1,
        content: "# Current state\n\nConcurrent edit B succeeded.",
        changeSummary: "Apply concurrent edit B.",
        sourceReferences: [{ kind: "watch-occurrence", id: "occurrence-b" }],
      }, command("concurrent-edit-b", "session-b", "run-edit-b", baseNow)),
    ]);
    assert.equal(editResults.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(editResults.filter(({ status }) => status === "rejected").length, 1);
    const rejectedEdit = editResults.find(({ status }) => status === "rejected");
    assert.equal(
      rejectedEdit?.status === "rejected" && hasCode(rejectedEdit.reason, "concurrent-update"),
      true,
    );
    const preservedEdit = await readInternalDocument(
      { documentId: concurrentlyEdited.document.id },
      command("read-concurrent-edit", "session-c", "run-read-edit", baseNow),
    );
    assert.equal(preservedEdit.currentRevision, 2);
    assert.match(preservedEdit.content ?? "", /Concurrent edit [AB] succeeded/u);
    assert.equal(preservedEdit.revisions.length, 2);

    await assert.rejects(
      createInternalDocument(
        {
          ...documentInput("Oversized UTF-8"),
          content: "é".repeat(INTERNAL_DOCUMENT_MAX_CONTENT_BYTES / 2 + 1),
        },
        command("oversized-document", "session-a", "run-bound", baseNow),
      ),
      (error) => hasCode(error, "content-bound"),
    );

    const unattached = await createInternalDocument(
      {
        ...documentInput("Chronological work log"),
        editingProfile: "chronological-log",
      },
      command("create-chronological-log", "session-a", "run-log", baseNow),
    );
    assert.equal(unattached.document.editingProfile, "chronological-log");
    await assert.rejects(
      attachInternalDocument(
        {
          documentId: unattached.document.id,
          expectedRevision: 1,
          attachment,
        },
        command("conflicting-attach", "session-a", "run-attach", baseNow),
      ),
      (error) => hasCode(error, "attachment-conflict"),
    );

    const missingAttachment = watchAttachment(randomUUID());
    await assert.rejects(
      createInternalDocument(
        {
          ...documentInput("Missing resource"),
          attachment: missingAttachment,
        },
        command("missing-attachment-target", "session-a", "run-missing", baseNow),
      ),
      (error) => hasCode(error, "attachment-target-not-found"),
    );

    const concurrentAttachment = watchAttachment(concurrentWatchId);
    const concurrentResults = await Promise.all([
      createInternalDocument(
        { ...documentInput("Concurrent A"), attachment: concurrentAttachment },
        command("concurrent-create-a", "session-a", "run-concurrent-a", baseNow),
      ),
      createInternalDocument(
        { ...documentInput("Concurrent B"), attachment: concurrentAttachment },
        command("concurrent-create-b", "session-b", "run-concurrent-b", baseNow),
      ),
    ]);
    assert.equal(concurrentResults[0]?.document.id, concurrentResults[1]?.document.id);
    assert.equal(concurrentResults.filter(({ created: value }) => value).length, 1);
    await withDocsAgentDatabase(async (db) => {
      const rows = await db.select().from(internalDocumentAttachments).where(and(
        eq(internalDocumentAttachments.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(internalDocumentAttachments.resourceId, concurrentWatchId),
      ));
      assert.equal(rows.length, 1);
    });

    const archived = await archiveInternalDocument(
      {
        documentId: created.document.id,
        expectedRevision: 2,
        reason: "The release continuity work is complete.",
        sourceReferences: [{ kind: "release", id: "v2.4.0" }],
      },
      command("archive-release", "session-c", "run-archive", baseNow),
    );
    assert.equal(archived.document.lifecycleState, "archived");
    assert.equal(archived.document.currentRevision, 3);
    assert.equal(archived.document.revisions[2]?.action, "archive");
    await assert.rejects(
      updateInternalDocument(
        {
          documentId: created.document.id,
          expectedRevision: 3,
          content: "Archived documents stay immutable.",
          changeSummary: "Invalid update.",
          sourceReferences: [],
        },
        command("update-archived", "session-c", "run-invalid", baseNow),
      ),
      (error) => hasCode(error, "lifecycle"),
    );

    const capacityDocument = await createInternalDocument(
      documentInput("Revision capacity"),
      command("create-capacity", "session-a", "run-capacity", baseNow),
    );
    await withDocsAgentDatabase(async (db) => {
      await db.update(internalDocuments).set({
        currentRevision: INTERNAL_DOCUMENT_MAX_REVISIONS,
      }).where(eq(internalDocuments.id, capacityDocument.document.id));
    });
    await assert.rejects(
      updateInternalDocument(
        {
          documentId: capacityDocument.document.id,
          expectedRevision: INTERNAL_DOCUMENT_MAX_REVISIONS,
          content: "One revision too many.",
          changeSummary: "Exceed the revision bound.",
          sourceReferences: [],
        },
        command("revision-overflow", "session-a", "run-overflow", baseNow),
      ),
      (error) => hasCode(error, "revision-bound"),
    );

    const expiringWatchId = randomUUID();
    await seedWatch(expiringWatchId, "active");
    const expiringAttachment = watchAttachment(expiringWatchId);
    const expiring = await createInternalDocument(
      {
        ...documentInput("Short retention"),
        attachment: expiringAttachment,
        retentionDays: 1,
        content: "This content must be removed after retention expires.",
      },
      command("create-expiring", "session-a", "run-expiring", baseNow),
    );
    const expired = await readInternalDocument(
      { documentId: expiring.document.id },
      command(
        "read-expired",
        "session-later",
        "run-later",
        new Date("2026-07-16T12:00:00.000Z"),
      ),
    );
    assert.equal(expired.lifecycleState, "expired");
    assert.equal(expired.content, null);
    assert.deepEqual(expired.revisions, []);
    assert.deepEqual(expired.attachments, []);
    assert.equal(
      await findInternalDocumentByAttachment(
        { attachment: expiringAttachment },
        command(
          "find-expired",
          "session-later",
          "run-find-expired",
          new Date("2026-07-16T12:00:00.000Z"),
        ),
      ),
      null,
    );

    const otherWorkspaceId = randomUUID();
    await withDocsAgentDatabase(async (db) => {
      await db.insert(internalDocuments).values({
        id: otherWorkspaceId,
        workspaceId: "other-workspace",
        title: "Other workspace",
        kind: "working-notes",
        editingProfile: "living-summary",
        lifecycleState: "active",
        currentRevision: 1,
        creationOperationKey: "other-workspace-create",
        retentionExpiresAt: "2026-12-01T00:00:00.000Z",
        archivedAt: null,
        expiredAt: null,
        createdAt: baseNow.toISOString(),
        updatedAt: baseNow.toISOString(),
      });
    });
    await assert.rejects(
      readInternalDocument(
        { documentId: otherWorkspaceId },
        command("cross-workspace-read", "session-a", "run-cross", baseNow),
      ),
      (error) => hasCode(error, "not-found"),
    );
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function documentInput(title: string) {
  return {
    title,
    kind: "working-notes" as const,
    editingProfile: "living-summary" as const,
    content: "# Notes\n\nInitial bounded working state.",
    retentionDays: 90,
    sourceReferences: [],
  };
}

function command(
  operationKey: string,
  sessionId: string,
  runId: string,
  now: Date,
) {
  return {
    authority: "docs_work.manage" as const,
    actor: { type: "agent" as const, id: "paige-agent" },
    sessionId,
    runId,
    operationKey,
    now,
  };
}

function watchAttachment(resourceId: string) {
  return {
    resourceType: "policy-bound-watch" as const,
    resourceId,
    relationship: "continuity" as const,
  };
}

async function seedWatch(id: string, lifecycleState: string): Promise<void> {
  await withDocsAgentDatabase(async (db) => {
    const now = "2026-07-14T12:00:00.000Z";
    await db.insert(policyBoundWatches).values({
      id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      lifecycleState,
      createdAt: now,
      updatedAt: now,
      effectiveRevisionId: null,
      stateRevision: 1,
    });
  });
}

function hasCode(error: unknown, code: InternalDocumentError["code"]): boolean {
  return error instanceof InternalDocumentError && error.code === code;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
