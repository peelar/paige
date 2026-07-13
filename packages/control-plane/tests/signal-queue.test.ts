import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";

import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import {
  createDocsSignal,
  listDocsSignalQueue,
  listDocsSignals,
} from "../src/docs-signals.ts";
import { test } from "vitest";

test("signal queue", async () => {
const tempRoot = await mkdtemp(join(tmpdir(), "docs-agent-signal-queue-"));
const databaseUrl = `file:${join(tempRoot, "queue.sqlite")}`;
const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
const originalVercel = process.env.VERCEL;
const originalNodeEnv = process.env.NODE_ENV;

process.env.DOCS_AGENT_DATABASE_URL = databaseUrl;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

try {
  await migrateDocsAgentDatabase();
  await seedSignals(databaseUrl);

  const open = await listDocsSignals({ limit: 100 });
  assert.deepEqual(
    open.signals.map(({ id }) => id),
    ["signal-linear-new", "signal-slack-old", "signal-linear-low"],
    "Open signals should sort by priority, then updated time, then id.",
  );

  const captured = await listDocsSignals({ statuses: ["captured"], limit: 100 });
  assert.deepEqual(captured.signals.map(({ id }) => id), ["signal-slack-old"]);

  const linear = await listDocsSignals({ sourceKinds: ["linear-issue"], limit: 100 });
  assert.deepEqual(
    linear.signals.map(({ id }) => id),
    ["signal-linear-new", "signal-linear-low"],
  );

  const includingClosed = await listDocsSignals({ openOnly: false, limit: 100 });
  assert.deepEqual(
    includingClosed.signals.map(({ id }) => id),
    ["signal-closed", "signal-linear-new", "signal-slack-old", "signal-linear-low"],
  );
  assert.equal(includingClosed.signals[0]?.priority, 100);

  const limited = await listDocsSignals({ openOnly: false, limit: 2 });
  assert.equal(limited.signals.length, 2);

  const created = await createDocsSignal({
    source: {
      kind: "external-context",
      provider: "fixture-provider",
      providerId: "secret-source",
      authors: [],
      sourceText: "raw source text must stay out of queue rows",
      metadata: { credential: "lin_api_never_render" },
    },
    sourceSummary: "A redacted operator-safe summary.",
    extractedClaims: [],
    likelyDocsConcepts: [],
    likelyDocsPages: [],
    productSurfaces: [],
    missingEvidence: [],
    priority: 0,
    links: [],
    artifacts: [],
  });
  const safeList = await listDocsSignalQueue({ statuses: [created.signal.status], limit: 100 });
  const serialized = JSON.stringify(safeList);
  assert.equal(serialized.includes("raw source text"), false);
  assert.equal(serialized.includes("lin_api_never_render"), false);
  assert.equal(serialized.includes("fixture-provider"), false);

  const client = createClient({ url: databaseUrl });
  try {
    await client.execute({
      sql: "UPDATE docs_signals SET source_kind = ? WHERE id = ?",
      args: ["invalid-provider-record", "signal-slack-old"],
    });
  } finally {
    client.close();
  }
  await assert.rejects(
    () => listDocsSignals({ openOnly: false, limit: 100 }),
    (error: unknown) => error instanceof Error && error.name === "ZodError",
  );
} finally {
  restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
  restoreEnvironment("VERCEL", originalVercel);
  restoreEnvironment("NODE_ENV", originalNodeEnv);
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Docs signal queue checks passed.");

async function seedSignals(url: string): Promise<void> {
  const client = createClient({ url });
  const rows = [
    signalRow({
      id: "signal-slack-old",
      status: "captured",
      sourceKind: "slack-thread",
      priority: 80,
      updatedAt: "2026-07-11T10:00:00.000Z",
    }),
    signalRow({
      id: "signal-linear-new",
      status: "docs-verified",
      sourceKind: "linear-issue",
      priority: 80,
      updatedAt: "2026-07-11T11:00:00.000Z",
    }),
    signalRow({
      id: "signal-linear-low",
      status: "needs-source-evidence",
      sourceKind: "linear-issue",
      priority: 35,
      updatedAt: "2026-07-11T12:00:00.000Z",
    }),
    signalRow({
      id: "signal-closed",
      status: "closed-already-covered",
      sourceKind: "manual-scenario",
      priority: 100,
      updatedAt: "2026-07-11T13:00:00.000Z",
    }),
  ];

  try {
    for (const row of rows) {
      await client.execute({
        sql: `INSERT INTO docs_signals (
          id, workspace_id, status, source_kind, source_summary,
          extracted_claims, likely_docs_concepts, likely_docs_pages,
          product_surfaces, missing_evidence, uncertainty, priority,
          next_action_at, captured_at, created_at, updated_at
        ) VALUES (?, 'default', ?, ?, ?, '[]', '[]', '[]', '[]', '[]', ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.status,
          row.sourceKind,
          `Summary for ${row.id}`,
          `Uncertainty for ${row.id}`,
          row.priority,
          "2026-07-12T09:00:00.000Z",
          row.updatedAt,
          row.updatedAt,
          row.updatedAt,
        ],
      });
    }
  } finally {
    client.close();
  }
}

function signalRow(input: {
  id: string;
  status: string;
  sourceKind: string;
  priority: number;
  updatedAt: string;
}) {
  return input;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
});
