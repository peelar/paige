import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { withDocsAgentDatabase } from "./db/client.js";
import { docsProfiles } from "./db/schema.js";
import { DEFAULT_WORKSPACE_ID } from "./setup-state.js";

export const DOCS_PROFILE_FORMAT_VERSION = 1;

export const docsProfileObservationSchema = z.object({
  value: z.string().trim().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(z.string().trim().min(1)).nonempty(),
});

export const docsProfileSchema = z.object({
  audiences: z.array(docsProfileObservationSchema),
  navigation: z.array(docsProfileObservationSchema),
  pageTypes: z.array(docsProfileObservationSchema),
  styleRules: z.array(docsProfileObservationSchema),
  terminology: z.array(docsProfileObservationSchema),
  componentsAndExamples: z.array(docsProfileObservationSchema),
  validation: z.array(docsProfileObservationSchema),
  inspectedSources: z.array(z.string()),
});

export const docsProfileIdentitySchema = z.object({
  repositoryUrl: z.string().trim().min(1),
  requestedRef: z.string().trim().min(1),
  docsRoot: z.string().trim().min(1),
  resolvedRevision: z.string().trim().min(1),
  sourceFingerprint: z.string().trim().min(1),
});

export const cachedDocsProfileSchema = z.object({
  ...docsProfileIdentitySchema.shape,
  workspaceId: z.literal(DEFAULT_WORKSPACE_ID),
  formatVersion: z.literal(DOCS_PROFILE_FORMAT_VERSION),
  profile: docsProfileSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  reused: z.boolean(),
});

export type DocsProfile = z.infer<typeof docsProfileSchema>;
export type DocsProfileIdentity = z.infer<typeof docsProfileIdentitySchema>;
export type CachedDocsProfile = z.infer<typeof cachedDocsProfileSchema>;

export async function readReusableDocsProfile(
  identity: DocsProfileIdentity,
  now = new Date(),
): Promise<{ profile: CachedDocsProfile | null; reason: string }> {
  const parsed = docsProfileIdentitySchema.parse(identity);
  const rows = await withDocsAgentDatabase((db) =>
    db.select().from(docsProfiles).where(and(
      eq(docsProfiles.workspaceId, DEFAULT_WORKSPACE_ID),
      eq(docsProfiles.repositoryUrl, parsed.repositoryUrl),
      eq(docsProfiles.requestedRef, parsed.requestedRef),
      eq(docsProfiles.docsRoot, parsed.docsRoot),
    )).limit(1),
  );
  const row = rows[0];
  if (row === undefined) return { profile: null, reason: "missing" };
  if (row.invalidatedReason !== null) return { profile: null, reason: row.invalidatedReason };
  if (row.formatVersion !== DOCS_PROFILE_FORMAT_VERSION) return { profile: null, reason: "unsupported-format" };
  if (row.resolvedRevision !== parsed.resolvedRevision) return { profile: null, reason: "revision-changed" };
  if (row.sourceFingerprint !== parsed.sourceFingerprint) return { profile: null, reason: "source-changed" };
  if (new Date(row.expiresAt) <= now) return { profile: null, reason: "expired" };

  try {
    return {
      profile: cachedDocsProfileSchema.parse({ ...row, profile: row.profile, reused: true }),
      reason: "fresh",
    };
  } catch {
    return { profile: null, reason: "corrupt" };
  }
}

export async function saveDocsProfile(input: {
  identity: DocsProfileIdentity;
  profile: DocsProfile;
  now?: Date;
  ttlMs?: number;
}): Promise<CachedDocsProfile> {
  const identity = docsProfileIdentitySchema.parse(input.identity);
  const profile = docsProfileSchema.parse(input.profile);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1_000)).toISOString();
  const values = {
    workspaceId: DEFAULT_WORKSPACE_ID,
    ...identity,
    formatVersion: DOCS_PROFILE_FORMAT_VERSION,
    profile,
    invalidatedReason: null,
    createdAt,
    expiresAt,
    updatedAt: createdAt,
  };
  await withDocsAgentDatabase((db) => db.insert(docsProfiles).values(values).onConflictDoUpdate({
    target: [docsProfiles.workspaceId, docsProfiles.repositoryUrl, docsProfiles.requestedRef, docsProfiles.docsRoot],
    set: values,
  }));
  return cachedDocsProfileSchema.parse({ ...values, reused: false });
}

export async function invalidateDocsProfile(input: {
  repositoryUrl: string;
  requestedRef: string;
  docsRoot: string;
  reason: "maintainer-correction" | "contradiction" | "manual-refresh";
}): Promise<void> {
  await withDocsAgentDatabase((db) => db.update(docsProfiles).set({
    invalidatedReason: input.reason,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(docsProfiles.workspaceId, DEFAULT_WORKSPACE_ID),
    eq(docsProfiles.repositoryUrl, input.repositoryUrl),
    eq(docsProfiles.requestedRef, input.requestedRef),
    eq(docsProfiles.docsRoot, input.docsRoot),
  )));
}
