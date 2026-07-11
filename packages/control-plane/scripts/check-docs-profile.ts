import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDocsAgentDatabase } from "../src/db/client.js";
import { invalidateDocsProfile, readReusableDocsProfile, saveDocsProfile } from "../src/docs-profile.js";

const root = await mkdtemp(join(tmpdir(), "docs-profile-"));
const previous = process.env.DOCS_AGENT_DATABASE_URL;
process.env.DOCS_AGENT_DATABASE_URL = `file:${join(root, "profile.sqlite")}`;
try {
  await migrateDocsAgentDatabase();
  const identity = { repositoryUrl: "https://github.com/example/docs.git", requestedRef: "main", docsRoot: "docs", resolvedRevision: "abc123", sourceFingerprint: "fingerprint-a" };
  const profile = { audiences: [{ value: "Developers", confidence: "high" as const, sources: ["README.md"] }], navigation: [], pageTypes: [], styleRules: [], terminology: [], componentsAndExamples: [], validation: [], inspectedSources: ["README.md"] };
  const saved = await saveDocsProfile({ identity, profile, now: new Date("2026-07-11T10:00:00Z"), ttlMs: 60_000 });
  assert.equal(saved.reused, false);
  assert.equal((await readReusableDocsProfile(identity, new Date("2026-07-11T10:00:30Z"))).profile?.reused, true);
  assert.equal((await readReusableDocsProfile({ ...identity, resolvedRevision: "def456" })).reason, "revision-changed");
  assert.equal((await readReusableDocsProfile({ ...identity, sourceFingerprint: "fingerprint-b" })).reason, "source-changed");
  assert.equal((await readReusableDocsProfile(identity, new Date("2026-07-11T10:02:00Z"))).reason, "expired");
  await invalidateDocsProfile({ repositoryUrl: identity.repositoryUrl, requestedRef: identity.requestedRef, docsRoot: identity.docsRoot, reason: "contradiction" });
  assert.equal((await readReusableDocsProfile(identity)).reason, "contradiction");
} finally {
  if (previous === undefined) delete process.env.DOCS_AGENT_DATABASE_URL; else process.env.DOCS_AGENT_DATABASE_URL = previous;
  await rm(root, { recursive: true, force: true });
}
console.log("Docs profile cache checks passed.");
