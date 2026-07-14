import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import {
  listCapabilityResolutions,
  recordCapabilityResolution,
  recordCapabilityResolutionInputSchema,
  type RecordCapabilityResolutionInput,
} from "../src/capability-resolution-events.ts";
import { migrateDocsAgentDatabase } from "../src/db/client.ts";

test("capability resolution projections are durable, replay-safe, bounded, and redacted", async () => {
  await withTemporaryDatabase(async () => {
    const input: RecordCapabilityResolutionInput = {
      sessionId: "session-capability-85",
      turnId: "turn-1",
      contextClass: "eve" as const,
      status: "resolved" as const,
      capabilityFamilies: ["publication.publish", "repository.read"],
      toolNames: ["publish_working_repository_pr", "working_repository"],
      reasonCodes: ["interactive-principal"],
      reservationId: null,
      watchId: null,
      effectiveRevisionId: null,
    };

    const first = await recordCapabilityResolution(input);
    const replay = await recordCapabilityResolution(input);
    assert.equal(replay.id, first.id);

    const narrowed = await recordCapabilityResolution({
      ...input,
      status: "denied",
      capabilityFamilies: [],
      toolNames: [],
      reasonCodes: ["prepared-draft-unavailable"],
    });
    assert.notEqual(narrowed.id, first.id);

    const events = await listCapabilityResolutions({
      sessionId: input.sessionId,
    });
    assert.equal(events.length, 2);
    assert.ok(events.some(({ id }) => id === first.id));
    assert.ok(events.some(({ id }) => id === narrowed.id));
    assert.deepEqual(
      Object.keys(first).sort(),
      [
        "capabilityFamilies",
        "contextClass",
        "createdAt",
        "effectiveRevisionId",
        "id",
        "reasonCodes",
        "reservationId",
        "sessionId",
        "status",
        "toolNames",
        "turnId",
        "watchId",
      ].sort(),
    );
    assert.doesNotMatch(
      JSON.stringify(events),
      /authorization|credential|prompt|providerPayload|secret|token/u,
    );

    assert.throws(
      () => recordCapabilityResolutionInputSchema.parse({
        ...input,
        prompt: "private prompt",
      }),
      /unrecognized key/i,
    );
  });
});

async function withTemporaryDatabase(run: () => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "paige-capability-events-"));
  const originalDatabaseUrl = process.env.DOCS_AGENT_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.DOCS_AGENT_DATABASE_URL = `file:${join(tempRoot, "capabilities.sqlite")}`;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
  try {
    await migrateDocsAgentDatabase();
    await run();
  } finally {
    restoreEnvironment("DOCS_AGENT_DATABASE_URL", originalDatabaseUrl);
    restoreEnvironment("VERCEL", originalVercel);
    restoreEnvironment("NODE_ENV", originalNodeEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
