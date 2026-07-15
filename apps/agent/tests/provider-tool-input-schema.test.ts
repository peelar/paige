import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  docsWorkManageInputSchema,
  docsWorkManageProviderInputSchema,
  docsWorkReadInputSchema,
  docsWorkReadProviderInputSchema,
} from "../agent/lib/docs-work";
import { authoringWorkspaceInputSchema } from "../agent/tools/authoring_workspace";
import { docsFollowUpInputSchema } from "../agent/tools/docs_follow_up";
import { internalDocumentInputSchema } from "../agent/tools/internal_document";
import { workspaceKnowledgeInputSchema } from "../agent/tools/workspace_knowledge";
import { workingRepositoryInputSchema } from "../agent/tools/working_repository";

type JsonSchema = {
  anyOf?: unknown;
  maximum?: number;
  maxItems?: number;
  oneOf?: unknown;
  properties?: Record<string, JsonSchema>;
  type?: string;
};

test("provider-facing multiplexer schemas expose direct top-level properties", () => {
  const authoringSchema = providerJsonSchema(authoringWorkspaceInputSchema);
  assertTopLevelObject(authoringSchema);
  assert.equal(authoringSchema.properties?.operations?.type, "array");
  assert.equal(authoringSchema.properties?.taskReferences?.type, "array");
  assert.equal(authoringSchema.properties?.paths?.type, "array");
  assert.equal(authoringSchema.properties?.evidence?.type, "array");
  assert.equal(authoringSchema.properties?.uncertainty?.type, "array");
  assert.equal(authoringSchema.properties?.checks?.type, "array");

  const repositorySchema = providerJsonSchema(workingRepositoryInputSchema);
  assertTopLevelObject(repositorySchema);
  assert.equal(repositorySchema.properties?.limit?.type, "integer");
  assert.equal(repositorySchema.properties?.limit?.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(
    repositorySchema.properties?.maxCharacters?.maximum,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(repositorySchema.properties?.validatorIds?.type, "array");

  const knowledgeSchema = providerJsonSchema(workspaceKnowledgeInputSchema);
  assertTopLevelObject(knowledgeSchema);
  assert.equal(knowledgeSchema.properties?.sourceIds?.type, "array");
  assert.equal(knowledgeSchema.properties?.caseSensitive?.type, "boolean");
  assert.equal(knowledgeSchema.properties?.limit?.type, "integer");
  assert.equal(knowledgeSchema.properties?.startLine?.type, "integer");

  const followUpSchema = providerJsonSchema(docsFollowUpInputSchema);
  assertTopLevelObject(followUpSchema);
  assert.equal(followUpSchema.properties?.limit?.type, "integer");
  assert.equal(followUpSchema.properties?.dueAt?.type, "string");

  const internalDocumentSchema = providerJsonSchema(internalDocumentInputSchema);
  assertTopLevelObject(internalDocumentSchema);
  assert.equal(internalDocumentSchema.properties?.sourceReferences?.type, "array");
  assert.equal(internalDocumentSchema.properties?.attachment?.type, "object");
  assert.equal(internalDocumentSchema.properties?.retentionDays?.type, "integer");
  assert.equal(internalDocumentSchema.properties?.expectedRevision?.type, "integer");

  const manageSchema = providerJsonSchema(docsWorkManageProviderInputSchema);
  assertTopLevelObject(manageSchema);
  assertSameTopLevelPropertyInventory(
    docsWorkManageProviderInputSchema,
    docsWorkManageInputSchema,
    ["clearNextActionAt"],
  );
  assert.equal(manageSchema.properties?.extractedClaims?.type, "array");
  assert.equal(manageSchema.properties?.missingEvidence?.type, "array");
  assert.equal(manageSchema.properties?.links?.type, "array");
  assert.equal(manageSchema.properties?.artifacts?.type, "array");
  assert.equal(manageSchema.properties?.docsPages?.type, "array");
  assert.equal(manageSchema.properties?.searchQueries?.type, "array");
  assert.equal(manageSchema.properties?.priority?.type, "integer");
  assert.equal(manageSchema.properties?.maxSearchQueries?.type, "integer");
  assert.equal(manageSchema.properties?.expectedRevision?.type, "integer");
  assert.equal(manageSchema.properties?.outcome?.type, "string");
  assert.equal(manageSchema.properties?.outcome?.anyOf, undefined);
  assert.equal(manageSchema.properties?.outcome?.oneOf, undefined);
  assert.equal(manageSchema.properties?.clearNextActionAt?.type, "boolean");
  assert.equal(manageSchema.properties?.decision?.type, "object");
  assert.equal(manageSchema.properties?.plan?.type, "object");
  assert.equal(manageSchema.properties?.missingEvidence?.maxItems, 30);
  assert.equal(manageSchema.properties?.links?.maxItems, 50);
  assert.equal(manageSchema.properties?.artifacts?.maxItems, 20);

  const readSchema = providerJsonSchema(docsWorkReadProviderInputSchema);
  assertTopLevelObject(readSchema);
  assertSameTopLevelPropertyInventory(
    docsWorkReadProviderInputSchema,
    docsWorkReadInputSchema,
  );
  assert.equal(readSchema.properties?.statuses?.type, "array");
  assert.equal(readSchema.properties?.sourceKinds?.type, "array");
  assert.equal(readSchema.properties?.openOnly?.type, "boolean");
  assert.equal(readSchema.properties?.limit?.type, "integer");
});

test("authoring provider input keeps strict mode validation and array types", () => {
  const operation = {
    kind: "write-text" as const,
    path: "docs/new-page.md",
    content: "# New page\n",
    createOnly: true as const,
  };

  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "apply",
    operations: [operation],
  }).success, true);
  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "apply",
    operations: JSON.stringify([operation]),
  }).success, false);
  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "inspect",
    paths: ["docs/new-page.md"],
  }).success, true);
  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "inspect",
    paths: '["docs/new-page.md"]',
  }).success, false);
  const prepared = authoringWorkspaceInputSchema.parse({
    mode: "prepare",
    patchSummary: "Add the requested page.",
  });
  assert.deepEqual(prepared.checks, ["diff-check"]);
  assert.deepEqual(prepared.evidence, []);
  assert.deepEqual(prepared.uncertainty, []);
  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "prepare",
    patchSummary: "Add the requested page.",
    checks: '["diff-check"]',
  }).success, false);
  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "apply",
    operations: [],
  }).success, false);
  assert.equal(authoringWorkspaceInputSchema.safeParse({
    mode: "inspect",
    unknown: true,
  }).success, false);
});

test("working repository provider input preserves mode bounds and rejects coerced values", () => {
  const search = workingRepositoryInputSchema.parse({
    mode: "search",
    query: "authoring",
  });
  assert.equal(search.limit, 50);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "search",
    query: "authoring",
    limit: "50",
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "run_validators",
    validatorIds: ["internal.diff-quiet"],
  }).success, true);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "run_validators",
    validatorIds: '["internal.diff-quiet"]',
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "run_validators",
    validatorIds: "internal.diff-quiet",
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "list",
    limit: 200,
  }).success, true);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "list",
    limit: 201,
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "search",
    query: "authoring",
    limit: 100,
  }).success, true);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "search",
    query: "authoring",
    limit: 101,
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "diff",
    maxCharacters: 50_000,
  }).success, true);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "diff",
    maxCharacters: 50_001,
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "read",
    path: "docs/page.md",
    maxCharacters: 24_000,
  }).success, true);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "read",
    path: "docs/page.md",
    maxCharacters: 24_001,
  }).success, false);
  assert.equal(workingRepositoryInputSchema.safeParse({
    mode: "search",
  }).success, false);
});

test("workspace knowledge provider input preserves mode defaults and rejects coerced values", () => {
  const search = workspaceKnowledgeInputSchema.parse({
    mode: "search",
    query: "authoring",
  });
  assert.equal(search.kind, "literal");
  assert.equal(search.caseSensitive, false);
  assert.equal(search.limit, 50);

  const read = workspaceKnowledgeInputSchema.parse({
    mode: "read",
    sourceId: "source-1",
    path: "docs/page.md",
  });
  assert.equal(read.startLine, 1);
  assert.equal(read.maxCharacters, 24_000);

  assert.equal(workspaceKnowledgeInputSchema.safeParse({
    mode: "search",
    query: "authoring",
    sourceIds: '["source-1"]',
  }).success, false);
  assert.equal(workspaceKnowledgeInputSchema.safeParse({
    mode: "search",
    query: "authoring",
    caseSensitive: "false",
  }).success, false);
  assert.equal(workspaceKnowledgeInputSchema.safeParse({
    mode: "search",
    query: "authoring",
    limit: "50",
  }).success, false);
  assert.equal(workspaceKnowledgeInputSchema.safeParse({
    mode: "list",
    unknown: true,
  }).success, false);
});

test("docs follow-up provider input preserves list defaults and rejects coerced values", () => {
  const list = docsFollowUpInputSchema.parse({ mode: "list" });
  assert.equal(list.limit, 50);
  assert.equal(docsFollowUpInputSchema.safeParse({
    mode: "create",
    signalId: "signal-1",
    reason: "Check this later.",
    dueAt: "2026-07-16T12:00:00.000Z",
  }).success, true);
  assert.equal(docsFollowUpInputSchema.safeParse({
    mode: "list",
    limit: "50",
  }).success, false);
  assert.equal(docsFollowUpInputSchema.safeParse({
    mode: "list",
    status: '["pending"]',
  }).success, false);
  assert.equal(docsFollowUpInputSchema.safeParse({
    mode: "schedule-status",
    unknown: true,
  }).success, false);
});

test("internal document provider input preserves create defaults and rejects coerced values", () => {
  const created = internalDocumentInputSchema.parse({
    mode: "create",
    title: "Working notes",
    content: "Current state.",
  });
  assert.equal(created.kind, "working-notes");
  assert.equal(created.editingProfile, "living-summary");
  assert.equal(created.retentionDays, 90);
  assert.deepEqual(created.sourceReferences, []);

  const attachment = {
    resourceType: "policy-bound-watch" as const,
    resourceId: "00000000-0000-4000-8000-000000000001",
    relationship: "continuity" as const,
  };
  assert.equal(internalDocumentInputSchema.safeParse({
    mode: "find",
    attachment,
  }).success, true);
  assert.equal(internalDocumentInputSchema.safeParse({
    mode: "create",
    title: "Working notes",
    content: "Current state.",
    retentionDays: "90",
  }).success, false);
  assert.equal(internalDocumentInputSchema.safeParse({
    mode: "create",
    title: "Working notes",
    content: "Current state.",
    sourceReferences: "[]",
  }).success, false);
  assert.equal(internalDocumentInputSchema.safeParse({
    mode: "find",
    attachment: JSON.stringify(attachment),
  }).success, false);
  assert.equal(internalDocumentInputSchema.safeParse({
    mode: "update",
    documentId: "00000000-0000-4000-8000-000000000002",
    expectedRevision: "1",
    content: "Updated state.",
    changeSummary: "Refresh state.",
  }).success, false);
  assert.equal(internalDocumentInputSchema.safeParse({
    mode: "read",
    documentId: "00000000-0000-4000-8000-000000000002",
    unknown: true,
  }).success, false);
});

test("docs work provider inputs preserve operation defaults and strict types", () => {
  const verification = docsWorkManageProviderInputSchema.parse({
    operation: "verify_current_docs",
    workId: "work-1",
  });
  assert.deepEqual(verification.docsPages, []);
  assert.deepEqual(verification.searchQueries, []);
  assert.equal(verification.maxSearchQueries, 5);

  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    operation: "verify_current_docs",
    workId: "work-1",
    docsPages: '["docs/page.md"]',
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    operation: "verify_current_docs",
    workId: "work-1",
    docsPages: ["docs/page.md"],
    maxSearchQueries: "5",
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    operation: "resume",
    workId: "work-1",
    expectedRevision: 1,
    operationKey: "resume-1",
    summary: "Resume the work.",
    artifacts: [],
  }).success, false);

  const triage = {
    operation: "triage" as const,
    workId: "work-1",
    outcome: "continue" as const,
    reason: "Continue the work.",
    nextActionAt: "2026-07-16T12:00:00.000Z",
    missingEvidence: Array.from({ length: 30 }, (_, index) => `evidence-${index}`),
    links: Array.from({ length: 50 }, () => ({ kind: "other" as const })),
    artifacts: Array.from({ length: 20 }, () => ({ kind: "other" as const })),
  };
  assert.equal(docsWorkManageProviderInputSchema.safeParse(triage).success, true);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...triage,
    missingEvidence: [...triage.missingEvidence, "one-too-many"],
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...triage,
    links: [...triage.links, { kind: "other" as const }],
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...triage,
    artifacts: [...triage.artifacts, { kind: "other" as const }],
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...triage,
    nextActionAt: null,
  }).success, false);
  const clearedTriage = docsWorkManageProviderInputSchema.parse({
    ...triage,
    nextActionAt: undefined,
    clearNextActionAt: true,
  });
  assert.equal(clearedTriage.nextActionAt, null);
  assert.equal("clearNextActionAt" in clearedTriage, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...triage,
    clearNextActionAt: true,
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    operation: "create",
    clearNextActionAt: true,
  }).success, false);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...triage,
    outcome: "failed",
  }).success, false);

  const finish = {
    operation: "finish" as const,
    workId: "work-1",
    expectedRevision: 1,
    operationKey: "finish-1",
    summary: "Finish the work.",
    outcome: "failed" as const,
  };
  assert.equal(docsWorkManageProviderInputSchema.safeParse(finish).success, true);
  assert.equal(docsWorkManageProviderInputSchema.safeParse({
    ...finish,
    outcome: "continue",
  }).success, false);

  const find = docsWorkReadProviderInputSchema.parse({ operation: "find" });
  assert.deepEqual(find.statuses, []);
  assert.deepEqual(find.sourceKinds, []);
  assert.equal(find.openOnly, true);
  assert.equal(find.limit, 20);
  assert.equal(docsWorkReadProviderInputSchema.safeParse({
    operation: "find",
    statuses: '["captured"]',
  }).success, false);
  assert.equal(docsWorkReadProviderInputSchema.safeParse({
    operation: "find",
    limit: "20",
  }).success, false);
  assert.equal(docsWorkReadProviderInputSchema.safeParse({
    operation: "inspect",
    workId: "work-1",
    limit: 20,
  }).success, false);
});

function providerJsonSchema(schema: Parameters<typeof z.toJSONSchema>[0]): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
}

function assertTopLevelObject(schema: JsonSchema): void {
  assert.equal(schema.type, "object");
  assert.ok(schema.properties);
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.oneOf, undefined);
}

function assertSameTopLevelPropertyInventory(
  providerSchema: Parameters<typeof z.toJSONSchema>[0],
  internalSchema: Parameters<typeof z.toJSONSchema>[0],
  providerOnlyProperties: string[] = [],
): void {
  const provider = providerJsonSchema(providerSchema);
  const internal = providerJsonSchema(internalSchema);
  const branches = Array.isArray(internal.oneOf)
    ? internal.oneOf
    : Array.isArray(internal.anyOf)
      ? internal.anyOf
      : [];
  const internalProperties = new Set(
    (branches as JsonSchema[]).flatMap((branch) =>
      Object.keys(branch.properties ?? {})),
  );
  assert.deepEqual(
    Object.keys(provider.properties ?? {}).sort(),
    [...internalProperties, ...providerOnlyProperties].sort(),
  );
}
