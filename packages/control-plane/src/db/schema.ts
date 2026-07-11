import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspaceSetup = sqliteTable("workspace_setup", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  workingRepositoryInput: text("working_repository_input", {
    mode: "json",
  }).$type<unknown>(),
  githubWriteback: text("github_writeback", { mode: "json" })
    .$type<unknown>()
    .notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const docsProfiles = sqliteTable(
  "docs_profiles",
  {
    workspaceId: text("workspace_id").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    requestedRef: text("requested_ref").notNull(),
    docsRoot: text("docs_root").notNull(),
    resolvedRevision: text("resolved_revision").notNull(),
    formatVersion: integer("format_version").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    profile: text("profile", { mode: "json" }).$type<unknown>().notNull(),
    invalidatedReason: text("invalidated_reason"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("docs_profiles_identity_idx").on(
      table.workspaceId,
      table.repositoryUrl,
      table.requestedRef,
      table.docsRoot,
    ),
    index("docs_profiles_expiry_idx").on(table.workspaceId, table.expiresAt),
  ],
);

export const docsSignals = sqliteTable(
  "docs_signals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    status: text("status").notNull(),
    sourceKind: text("source_kind").notNull(),
    dedupeKey: text("dedupe_key"),
    sourceSummary: text("source_summary").notNull(),
    extractedClaims: text("extracted_claims", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    likelyDocsConcepts: text("likely_docs_concepts", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    likelyDocsPages: text("likely_docs_pages", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    productSurfaces: text("product_surfaces", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    missingEvidence: text("missing_evidence", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    uncertainty: text("uncertainty"),
    priority: integer("priority").notNull().default(0),
    nextActionAt: text("next_action_at"),
    capturedAt: text("captured_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("docs_signals_workspace_dedupe_idx").on(
      table.workspaceId,
      table.dedupeKey,
    ),
    index("docs_signals_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("docs_signals_workspace_source_idx").on(
      table.workspaceId,
      table.sourceKind,
      table.updatedAt,
    ),
    index("docs_signals_next_action_idx").on(table.workspaceId, table.nextActionAt),
  ],
);

export const docsSignalSources = sqliteTable(
  "docs_signal_sources",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => docsSignals.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    provider: text("provider"),
    providerId: text("provider_id"),
    permalink: text("permalink"),
    title: text("title"),
    authors: text("authors", { mode: "json" }).$type<unknown>().notNull(),
    sourceText: text("source_text"),
    sourceCreatedAt: text("source_created_at"),
    sourceUpdatedAt: text("source_updated_at"),
    capturedAt: text("captured_at").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("docs_signal_sources_signal_idx").on(table.signalId),
    index("docs_signal_sources_provider_idx").on(
      table.workspaceId,
      table.provider,
      table.providerId,
    ),
    index("docs_signal_sources_permalink_idx").on(table.workspaceId, table.permalink),
  ],
);

export const docsSignalLinks = sqliteTable(
  "docs_signal_links",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => docsSignals.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    url: text("url"),
    externalId: text("external_id"),
    metadata: text("metadata", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("docs_signal_links_signal_idx").on(table.signalId),
    index("docs_signal_links_kind_idx").on(table.workspaceId, table.kind),
  ],
);

export const docsSignalArtifacts = sqliteTable(
  "docs_signal_artifacts",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => docsSignals.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    url: text("url"),
    path: text("path"),
    metadata: text("metadata", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("docs_signal_artifacts_signal_idx").on(table.signalId),
    index("docs_signal_artifacts_kind_idx").on(table.workspaceId, table.kind),
  ],
);

export const docsSignalEvents = sqliteTable(
  "docs_signal_events",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => docsSignals.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("docs_signal_events_signal_idx").on(table.signalId, table.createdAt),
    index("docs_signal_events_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const workspaceMemoryRecords = sqliteTable(
  "workspace_knowledge_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    statement: text("statement").notNull(),
    scope: text("scope"),
    summary: text("summary"),
    tags: text("tags", { mode: "json" }).$type<unknown>().notNull(),
    confidence: text("confidence").notNull(),
    freshUntil: text("fresh_until"),
    lastValidatedAt: text("last_validated_at"),
    staleReason: text("stale_reason"),
    proposedBy: text("proposed_by").notNull(),
    promotedAt: text("promoted_at"),
    retiredAt: text("retired_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workspace_knowledge_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("workspace_knowledge_kind_idx").on(
      table.workspaceId,
      table.kind,
      table.updatedAt,
    ),
    index("workspace_knowledge_fresh_until_idx").on(
      table.workspaceId,
      table.freshUntil,
    ),
  ],
);

export const workspaceMemorySources = sqliteTable(
  "workspace_knowledge_sources",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => workspaceMemoryRecords.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    url: text("url"),
    externalId: text("external_id"),
    sourceText: text("source_text"),
    metadata: text("metadata", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workspace_knowledge_sources_record_idx").on(table.recordId),
    index("workspace_knowledge_sources_kind_idx").on(table.workspaceId, table.kind),
    index("workspace_knowledge_sources_external_idx").on(
      table.workspaceId,
      table.kind,
      table.externalId,
    ),
  ],
);

export const workspaceMemoryEvents = sqliteTable(
  "workspace_knowledge_events",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => workspaceMemoryRecords.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workspace_knowledge_events_record_idx").on(table.recordId, table.createdAt),
    index("workspace_knowledge_events_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const schema = {
  docsProfiles,
  docsSignalArtifacts,
  docsSignalEvents,
  docsSignalLinks,
  docsSignalSources,
  docsSignals,
  workspaceMemoryEvents,
  workspaceMemoryRecords,
  workspaceMemorySources,
  workspaceSetup,
};
