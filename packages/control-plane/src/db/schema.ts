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

export const workspaceSetupEvents = sqliteTable(
  "workspace_setup_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actorId: text("actor_id").notNull(),
    actorLogin: text("actor_login").notNull(),
    action: text("action").notNull(),
    setupSnapshot: text("setup_snapshot", { mode: "json" })
      .$type<unknown>()
      .notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workspace_setup_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const connectorDeliveryVerifications = sqliteTable(
  "connector_delivery_verifications",
  {
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    connectorFingerprint: text("connector_fingerprint").notNull(),
    evidence: text("evidence").notNull(),
    verifiedAt: text("verified_at").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("connector_delivery_workspace_provider_idx").on(
      table.workspaceId,
      table.provider,
    ),
  ],
);

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

export const docsSignalOwnedWork = sqliteTable(
  "docs_signal_owned_work",
  {
    id: text("id").primaryKey(),
    signalId: text("signal_id")
      .notNull()
      .references(() => docsSignals.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    status: text("status").notNull(),
    sessionId: text("session_id").notNull(),
    startedRunId: text("started_run_id").notNull(),
    lastRunId: text("last_run_id").notNull(),
    conversation: text("conversation", { mode: "json" }).$type<unknown>().notNull(),
    intendedOutcome: text("intended_outcome").notNull(),
    references: text("references", { mode: "json" }).$type<unknown>().notNull(),
    outcome: text("outcome"),
    revision: integer("revision").notNull().default(1),
    lastOperationKey: text("last_operation_key").notNull(),
    lastMilestone: text("last_milestone"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("docs_signal_owned_work_signal_idx").on(
      table.workspaceId,
      table.signalId,
    ),
    index("docs_signal_owned_work_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("docs_signal_owned_work_session_idx").on(
      table.workspaceId,
      table.sessionId,
    ),
  ],
);

export const docsFollowUps = sqliteTable(
  "docs_follow_ups",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    signalId: text("signal_id").notNull().references(() => docsSignals.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull(),
    processedOccurrence: text("processed_occurrence"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("docs_follow_ups_due_idx").on(table.workspaceId, table.status, table.dueAt),
    index("docs_follow_ups_signal_idx").on(table.workspaceId, table.signalId),
  ],
);

export const docsFollowUpRuns = sqliteTable(
  "docs_follow_up_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    scheduleId: text("schedule_id").notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    timeZone: text("time_zone").notNull(),
    status: text("status").notNull(),
    dueCount: integer("due_count").notNull().default(0),
    processedCount: integer("processed_count").notNull().default(0),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("docs_follow_up_runs_occurrence_idx").on(table.workspaceId, table.scheduleId, table.occurrenceKey),
    index("docs_follow_up_runs_started_idx").on(table.workspaceId, table.startedAt),
  ],
);

export const chatSdkSubscriptions = sqliteTable("chat_sdk_subscriptions", {
  threadId: text("thread_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

export const chatSdkLocks = sqliteTable("chat_sdk_locks", {
  threadId: text("thread_id").primaryKey(),
  token: text("token").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const chatSdkKeyValues = sqliteTable("chat_sdk_key_values", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  expiresAt: integer("expires_at"),
});

export const chatSdkListEntries = sqliteTable(
  "chat_sdk_list_entries",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    sequence: integer("sequence").notNull(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [
    uniqueIndex("chat_sdk_list_entries_sequence_idx").on(table.key, table.sequence),
    index("chat_sdk_list_entries_expiry_idx").on(table.expiresAt),
  ],
);

export const chatSdkQueueEntries = sqliteTable(
  "chat_sdk_queue_entries",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    sequence: integer("sequence").notNull(),
    entry: text("entry", { mode: "json" }).$type<unknown>().notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("chat_sdk_queue_entries_sequence_idx").on(table.threadId, table.sequence),
    index("chat_sdk_queue_entries_expiry_idx").on(table.expiresAt),
  ],
);

export const slackThreadPresences = sqliteTable(
  "slack_thread_presence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    teamId: text("team_id"),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    chatThreadId: text("chat_thread_id").notNull(),
    continuationToken: text("continuation_token").notNull(),
    inviterUserId: text("inviter_user_id").notNull(),
    status: text("status").notNull(),
    enrolledAt: integer("enrolled_at").notNull(),
    lastActivityAt: integer("last_activity_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    endedAt: integer("ended_at"),
    endReason: text("end_reason"),
  },
  (table) => [
    uniqueIndex("slack_thread_presence_thread_idx").on(
      table.workspaceId,
      table.channelId,
      table.threadTs,
    ),
    uniqueIndex("slack_thread_presence_chat_thread_idx").on(
      table.workspaceId,
      table.chatThreadId,
    ),
    index("slack_thread_presence_expiry_idx").on(
      table.workspaceId,
      table.status,
      table.expiresAt,
    ),
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

export const productRuns = sqliteTable(
  "product_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    operationKey: text("operation_key").notNull(),
    runType: text("run_type").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    sessionId: text("session_id").notNull(),
    runId: text("run_id").notNull(),
    signalId: text("signal_id").references(() => docsSignals.id, {
      onDelete: "set null",
    }),
    workflowId: text("workflow_id"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    waitingSummary: text("waiting_summary"),
    failureSummary: text("failure_summary"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("product_runs_operation_idx").on(
      table.workspaceId,
      table.operationKey,
    ),
    index("product_runs_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("product_runs_session_idx").on(
      table.workspaceId,
      table.sessionId,
      table.runId,
    ),
    index("product_runs_expiry_idx").on(table.workspaceId, table.expiresAt),
  ],
);

export const productRunSteps = sqliteTable(
  "product_run_steps",
  {
    id: text("id").primaryKey(),
    productRunId: text("product_run_id")
      .notNull()
      .references(() => productRuns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    stepKey: text("step_key").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    failureSummary: text("failure_summary"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("product_run_steps_identity_idx").on(
      table.productRunId,
      table.stepKey,
    ),
    index("product_run_steps_run_idx").on(
      table.productRunId,
      table.startedAt,
    ),
  ],
);

export const productRunTraceLinks = sqliteTable(
  "product_run_trace_links",
  {
    id: text("id").primaryKey(),
    productRunId: text("product_run_id")
      .notNull()
      .references(() => productRuns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    url: text("url"),
    availability: text("availability").notNull(),
    unavailableReason: text("unavailable_reason"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("product_run_trace_links_kind_idx").on(
      table.productRunId,
      table.kind,
    ),
  ],
);

export const schema = {
  chatSdkKeyValues,
  chatSdkListEntries,
  chatSdkLocks,
  chatSdkQueueEntries,
  chatSdkSubscriptions,
  connectorDeliveryVerifications,
  docsProfiles,
  docsFollowUpRuns,
  docsFollowUps,
  docsSignalArtifacts,
  docsSignalEvents,
  docsSignalLinks,
  docsSignalOwnedWork,
  docsSignalSources,
  docsSignals,
  productRunSteps,
  productRunTraceLinks,
  productRuns,
  slackThreadPresences,
  workspaceMemoryEvents,
  workspaceMemoryRecords,
  workspaceMemorySources,
  workspaceSetup,
  workspaceSetupEvents,
};
