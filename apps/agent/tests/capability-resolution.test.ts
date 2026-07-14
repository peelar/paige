import assert from "node:assert/strict";
import { test } from "vitest";

import {
  canExecuteApprovedPublicationResume,
  resolveCapabilityMatrix,
} from "../agent/lib/capability-resolution";

const local = {
  authenticator: "local-dev",
  issuer: null,
  principalId: "local-dev",
  principalType: "local-dev",
};
const slack = {
  authenticator: "slack-webhook",
  issuer: "slack:T1",
  principalId: "slack:T1:U1",
  principalType: "user",
};
const linear = {
  authenticator: "linear-agent-webhook",
  issuer: "linear:ORG1",
  principalId: "linear:U1",
  principalType: "user",
};
const schedule = {
  authenticator: "app",
  issuer: null,
  principalId: "eve:app",
  principalType: "runtime",
};
const oidcUser = {
  authenticator: "oidc",
  issuer: "https://oidc.vercel.com/team",
  principalId: "user-1",
  principalType: "user",
};
const nullPrincipal = {
  authenticator: null,
  issuer: null,
  principalId: null,
  principalType: null,
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    current: local,
    initiator: local,
    channelKind: "http",
    enforceChannel: true,
    docsMaintenanceReady: true,
    githubWritebackReady: false,
    preparedDraftReady: false,
    watchReservationId: null,
    watchAuthority: null,
    ...overrides,
  };
}

test("verified Eve, Slack, Linear, and schedule principals get distinct surfaces", () => {
  const eve = resolveCapabilityMatrix(input());
  assert.equal(eve.contextClass, "eve");
  assert.ok(eve.toolNames.includes("configure_working_repository"));
  assert.ok(eve.toolNames.includes("authoring_workspace"));
  assert.ok(!eve.toolNames.includes("capture_slack_docs_signal"));
  assert.ok(!eve.toolNames.includes("process_due_docs_followups"));

  const slackResult = resolveCapabilityMatrix(input({ current: slack, initiator: slack, channelKind: "chat-sdk" }));
  assert.equal(slackResult.contextClass, "slack");
  assert.ok(slackResult.toolNames.includes("capture_slack_docs_signal"));
  assert.ok(slackResult.toolNames.includes("retrieve_slack_context"));
  assert.ok(!slackResult.toolNames.includes("capture_linear_docs_signal"));
  assert.ok(!slackResult.toolNames.includes("configure_working_repository"));

  const linearResult = resolveCapabilityMatrix(input({ current: linear, initiator: linear, channelKind: "linear" }));
  assert.equal(linearResult.contextClass, "linear");
  assert.ok(linearResult.toolNames.includes("capture_linear_docs_signal"));
  assert.ok(!linearResult.toolNames.includes("capture_slack_docs_signal"));
  assert.ok(!linearResult.toolNames.includes("retrieve_slack_context"));

  const scheduled = resolveCapabilityMatrix(input({ current: schedule, initiator: schedule, channelKind: "schedule" }));
  assert.equal(scheduled.contextClass, "schedule");
  assert.ok(scheduled.toolNames.includes("process_due_docs_followups"));
  assert.ok(!scheduled.toolNames.includes("docs_follow_up"));
  assert.ok(!scheduled.toolNames.includes("publish_working_repository_pr"));
  assert.ok(!scheduled.toolNames.includes("configure_working_repository"));
});

test("setup and prepared draft identity narrow repository mutation and publication", () => {
  const unconfigured = resolveCapabilityMatrix(input({ docsMaintenanceReady: false }));
  assert.ok(!unconfigured.toolNames.includes("working_repository"));
  assert.ok(!unconfigured.toolNames.includes("authoring_workspace"));
  assert.ok(!unconfigured.toolNames.includes("publish_working_repository_pr"));
  assert.ok(unconfigured.toolNames.includes("configure_working_repository"));

  const prepared = resolveCapabilityMatrix(input({
    current: oidcUser,
    initiator: oidcUser,
    githubWritebackReady: true,
    preparedDraftReady: true,
  }));
  assert.ok(prepared.capabilityFamilies.includes("publication.publish"));
  assert.ok(prepared.toolNames.includes("publish_working_repository_pr"));

  for (const missing of [
    { githubWritebackReady: false, preparedDraftReady: true },
    { githubWritebackReady: true, preparedDraftReady: false },
  ]) {
    assert.ok(!resolveCapabilityMatrix(input(missing)).toolNames.includes("publish_working_repository_pr"));
  }
});

test("watch tools derive only from exact server-resolved grants", () => {
  const reservationId = "a".repeat(64);
  const principal = {
    authenticator: "paige-watch-dispatch",
    issuer: "paige",
    principalId: `paige:watch-dispatch:${reservationId}`,
    principalType: "runtime",
  };
  const watchAuthority = {
    reservationId,
    watchId: "11111111-1111-4111-8111-111111111111",
    effectiveRevisionId: "22222222-2222-4222-8222-222222222222",
    capabilityGrants: ["knowledge.read", "docs_work.manage"] as const,
  };
  const watched = resolveCapabilityMatrix(input({
    current: principal,
    initiator: principal,
    channelKind: "chat-sdk",
    watchReservationId: reservationId,
    watchAuthority,
    githubWritebackReady: true,
    preparedDraftReady: true,
  }));
  assert.equal(watched.contextClass, "watch");
  assert.deepEqual(watched.capabilityFamilies, ["docs_work.manage", "knowledge.read"]);
  assert.ok(watched.toolNames.includes("workspace_knowledge"));
  assert.ok(watched.toolNames.includes("docs_work_manage"));
  assert.ok(!watched.toolNames.includes("working_repository"));
  assert.ok(!watched.toolNames.includes("authoring_workspace"));
  assert.ok(!watched.toolNames.includes("publish_working_repository_pr"));
  assert.ok(!watched.toolNames.includes("process_due_docs_followups"));

  const denied = resolveCapabilityMatrix(input({
    current: principal,
    initiator: principal,
    channelKind: "chat-sdk",
    watchReservationId: reservationId,
  }));
  assert.equal(denied.status, "denied");
  assert.deepEqual(denied.toolNames, []);
});

test("unknown, null, mismatched, runtime, and resolver-failure contexts fail closed", () => {
  const arbitrary = {
    authenticator: "forged",
    issuer: "attacker",
    principalId: "attacker",
    principalType: "user",
  };
  const oidcRuntime = { ...oidcUser, principalType: "runtime" };
  const mismatch = { ...slack, issuer: "slack:T2" };
  for (const overrides of [
    { current: arbitrary, initiator: arbitrary },
    { current: nullPrincipal, initiator: nullPrincipal },
    { current: slack, initiator: mismatch, channelKind: "chat-sdk" },
    { current: oidcRuntime, initiator: oidcUser },
    { resolverFailed: true },
  ]) {
    const denied = resolveCapabilityMatrix(input(overrides));
    assert.equal(denied.status, "denied");
    assert.deepEqual(denied.toolNames, []);
  }
});

test("dynamic visibility rejects a verified principal on the wrong channel", () => {
  for (const overrides of [
    { current: slack, initiator: slack, channelKind: "linear" },
    { current: linear, initiator: linear, channelKind: "chat-sdk" },
    { current: schedule, initiator: schedule, channelKind: "http" },
    { current: local, initiator: local, channelKind: "schedule" },
    { current: slack, initiator: slack, channelKind: null },
  ]) {
    const denied = resolveCapabilityMatrix(input(overrides));
    assert.equal(denied.contextClass, "unknown");
    assert.deepEqual(denied.toolNames, []);
  }
});

test("approval-resume execution requires the Vercel OIDC runtime and original human initiator", async () => {
  const operatorRuntime = {
    authenticator: "oidc",
    issuer: "https://oidc.vercel.com/team",
    principalId: "operator-runtime-1",
    principalType: "runtime",
  };
  const reservationId = "b".repeat(64);
  const watchRuntime = {
    authenticator: "paige-watch-dispatch",
    issuer: "paige",
    principalId: `paige:watch-dispatch:${reservationId}`,
    principalType: "runtime",
  };
  const exactResume = {
    toolName: "publish_working_repository_pr" as const,
    current: operatorRuntime,
    initiator: slack,
    preparedDraftReady: true,
    sessionId: "session-resume-85",
    runId: "turn-resume-85",
    callId: "call-resume-85",
  };
  const checked: unknown[] = [];
  const projected: unknown[] = [];
  const approved = async (value: unknown) => {
    checked.push(value);
    return true;
  };
  const dependencies = {
    checkApprovedResume: approved,
    recordResolution: async (value: unknown) => {
      projected.push(value);
      return { id: "c".repeat(64), createdAt: "2026-07-14T20:00:00.000Z", ...value } as never;
    },
  };

  assert.equal(
    await canExecuteApprovedPublicationResume(exactResume, dependencies),
    true,
  );
  assert.deepEqual(checked, [{
    sessionId: exactResume.sessionId,
    runId: exactResume.runId,
    callId: exactResume.callId,
    toolName: exactResume.toolName,
  }]);
  assert.deepEqual(projected, [{
    sessionId: exactResume.sessionId,
    turnId: exactResume.runId,
    contextClass: "approval-resume",
    status: "resolved",
    capabilityFamilies: ["publication.publish"],
    toolNames: ["publish_working_repository_pr"],
    reasonCodes: ["approved-publication-resume"],
    reservationId: null,
    watchId: null,
    effectiveRevisionId: null,
  }]);

  for (const denied of [
    { ...exactResume, current: schedule },
    { ...exactResume, initiator: schedule },
    { ...exactResume, current: watchRuntime, initiator: watchRuntime },
    { ...exactResume, preparedDraftReady: false },
  ]) {
    assert.equal(
      await canExecuteApprovedPublicationResume(denied, dependencies),
      false,
    );
  }
  assert.equal(checked.length, 1, "denied schedule/watch contexts never consult an approved row");
  assert.equal(projected.length, 1, "denied contexts never project publication authority");
});
