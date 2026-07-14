import type { DynamicResolveContext, ToolContext } from "eve/tools";

import {
  recordCapabilityResolution,
  hasApprovedToolResume,
  resolveWatchDispatchCapabilityAuthority,
  type CapabilityFamily,
  type CapabilityResolutionEvent,
  type WatchDispatchCapabilityAuthority,
} from "@docs-agent/control-plane/agent";

import { PAIGE_WATCH_CAPABILITY_REGISTRY } from "./slack-watch-admission";
import { inspectRepositoryWorkflowState } from "./repository-workflow-state";
import { getSetupStatus } from "./setup-state";

export const authoredToolNames = [
  "authoring_workspace",
  "capture_linear_docs_signal",
  "capture_slack_docs_signal",
  "configure_github_writeback",
  "configure_working_repository",
  "docs_follow_up",
  "docs_work_manage",
  "docs_work_read",
  "get_docs_profile",
  "get_setup_status",
  "internal_document",
  "memory_get",
  "memory_mark_stale",
  "memory_promote",
  "memory_propose",
  "memory_retire",
  "memory_search",
  "process_due_docs_followups",
  "publish_working_repository_pr",
  "retrieve_slack_context",
  "scan_watched_repositories",
  "working_repository",
  "workspace_knowledge",
] as const;

export type AuthoredToolName = (typeof authoredToolNames)[number];
export type CapabilityContextClass = CapabilityResolutionEvent["contextClass"];
export type CapabilityResolutionReason = CapabilityResolutionEvent["reasonCodes"][number];

interface PrincipalProjection {
  readonly principalId: string | null;
  readonly principalType: string | null;
  readonly authenticator: string | null;
  readonly issuer: string | null;
}

export interface CapabilityMatrixInput {
  readonly current: PrincipalProjection;
  readonly initiator: PrincipalProjection;
  readonly channelKind: string | null;
  readonly enforceChannel: boolean;
  readonly docsMaintenanceReady: boolean;
  readonly githubWritebackReady: boolean;
  readonly preparedDraftReady: boolean;
  readonly watchReservationId: string | null;
  readonly watchAuthority: WatchDispatchCapabilityAuthority | null;
  readonly resolverFailed?: boolean;
}

export interface CapabilityResolution {
  readonly contextClass: CapabilityContextClass;
  readonly status: "resolved" | "denied";
  readonly capabilityFamilies: readonly CapabilityFamily[];
  readonly toolNames: readonly AuthoredToolName[];
  readonly reasonCodes: readonly CapabilityResolutionReason[];
  readonly reservationId: string | null;
  readonly watchId: string | null;
  readonly effectiveRevisionId: string | null;
}

const eventResolutionCache = new WeakMap<object, Promise<CapabilityResolution>>();

type ResolverSession = Pick<ToolContext["session"], "id" | "auth">;
type ResolverContext = Pick<DynamicResolveContext, "session" | "channel">;

const familyTools: Readonly<Record<CapabilityFamily, readonly AuthoredToolName[]>> = {
  "knowledge.read": ["workspace_knowledge"],
  "repository.read": ["working_repository", "get_docs_profile"],
  "docs_work.manage": ["docs_work_read", "docs_work_manage", "internal_document"],
  "draft.edit": ["authoring_workspace"],
  "follow_up.schedule": ["docs_follow_up"],
  "provider.deliver": [],
  "publication.publish": ["publish_working_repository_pr"],
};

export function resolveCapabilityMatrix(input: CapabilityMatrixInput): CapabilityResolution {
  const contextClass = classifyContext(
    input.current,
    input.initiator,
    input.watchReservationId,
    input.channelKind,
    input.enforceChannel,
  );
  const families = new Set<CapabilityFamily>();
  const tools = new Set<AuthoredToolName>();
  const reasons = new Set<CapabilityResolutionReason>();

  if (input.resolverFailed) {
    reasons.add("resolver-failure");
    return resolution(contextClass, families, tools, reasons, input);
  }

  if (contextClass === "unknown") {
    reasons.add("principal-unverified");
    return resolution(contextClass, families, tools, reasons, input);
  }

  if (contextClass === "watch") {
    if (input.watchAuthority === null || input.watchReservationId === null) {
      reasons.add("watch-authority-unavailable");
      return resolution(contextClass, families, tools, reasons, input);
    }
    reasons.add("watch-authority");
    for (const family of input.watchAuthority.capabilityGrants) families.add(family);
  } else if (contextClass === "schedule") {
    reasons.add("schedule-principal");
    families.add("docs_work.manage");
    families.add("follow_up.schedule");
    if (input.docsMaintenanceReady) {
      families.add("knowledge.read");
      families.add("repository.read");
      families.add("draft.edit");
    } else {
      reasons.add("setup-not-ready");
    }
  } else {
    reasons.add(
      contextClass === "slack"
        ? "slack-principal"
        : contextClass === "linear"
          ? "linear-principal"
          : "interactive-principal",
    );
    families.add("docs_work.manage");
    families.add("follow_up.schedule");
    if (input.docsMaintenanceReady) {
      families.add("knowledge.read");
      families.add("repository.read");
      families.add("draft.edit");
    } else {
      reasons.add("setup-not-ready");
    }
    if (input.githubWritebackReady && input.preparedDraftReady) {
      families.add("publication.publish");
    } else {
      if (!input.githubWritebackReady) reasons.add("writeback-not-ready");
      if (!input.preparedDraftReady) reasons.add("prepared-draft-unavailable");
    }
  }

  for (const family of families) {
    for (const tool of familyTools[family]) tools.add(tool);
  }

  if (contextClass === "eve") {
    tools.add("get_setup_status");
    tools.add("configure_working_repository");
    if (input.docsMaintenanceReady) tools.add("configure_github_writeback");
    for (const tool of [
      "memory_get",
      "memory_search",
      "memory_propose",
      "memory_promote",
      "memory_mark_stale",
      "memory_retire",
    ] as const) tools.add(tool);
  }
  if (contextClass === "slack") {
    tools.add("capture_slack_docs_signal");
    tools.add("retrieve_slack_context");
    tools.add("memory_get");
    tools.add("memory_search");
    tools.add("memory_propose");
  }
  if (contextClass === "linear") {
    tools.add("capture_linear_docs_signal");
    tools.add("memory_get");
    tools.add("memory_search");
    tools.add("memory_propose");
  }
  if (contextClass === "schedule") {
    tools.delete("docs_follow_up");
    tools.add("process_due_docs_followups");
  }
  if (contextClass !== "watch" && contextClass !== "schedule" && input.docsMaintenanceReady) {
    tools.add("scan_watched_repositories");
  }

  return resolution(contextClass, families, tools, reasons, input);
}

export function resolveDynamicCapabilities(
  event: unknown,
  context: ResolverContext,
): Promise<CapabilityResolution> {
  const turnId = turnIdFromEvent(event);
  if (typeof event !== "object" || event === null) {
    return resolveRuntimeCapabilities(
      context.session,
      "unavailable",
      context.channel.kind ?? null,
      true,
      true,
    );
  }
  const existing = eventResolutionCache.get(event);
  if (existing !== undefined) return existing;
  const resolving = resolveRuntimeCapabilities(
    context.session,
    turnId ?? "unavailable",
    context.channel.kind ?? null,
    true,
    turnId === null,
  );
  eventResolutionCache.set(event, resolving);
  return resolving;
}

export async function requireCapabilityToolExecution(
  toolName: AuthoredToolName,
  ctx: ToolContext,
): Promise<void> {
  const resolved = await resolveRuntimeCapabilities(
    ctx.session,
    ctx.session.turn.id,
    null,
    false,
  );
  if (resolved.toolNames.includes(toolName)) return;
  const current = projectPrincipal(ctx.session.auth.current);
  const initiator = projectPrincipal(ctx.session.auth.initiator);
  if (
    await canExecuteApprovedPublicationResume({
      toolName,
      current,
      initiator,
      preparedDraftReady: preparedDraftIsReady(),
      sessionId: ctx.session.id,
      runId: ctx.session.turn.id,
      callId: ctx.callId,
    })
  ) return;
  throw new Error(`The ${toolName} capability is unavailable in this verified runtime context.`);
}

async function resolveRuntimeCapabilities(
  session: ResolverSession,
  turnId: string,
  channelKind: string | null,
  enforceChannel: boolean,
  forceFailure = false,
): Promise<CapabilityResolution> {
  const current = projectPrincipal(session.auth.current);
  const initiator = projectPrincipal(session.auth.initiator);
  const reservationId = watchReservationId(current, initiator);

  try {
    if (forceFailure) throw new Error("Dynamic resolver event has no verified turn id.");
    const [setup, watchAuthority] = await Promise.all([
      getSetupStatus(),
      reservationId === null
        ? Promise.resolve(null)
        : resolveWatchDispatchCapabilityAuthority(reservationId, {
            capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
          }),
    ]);
    const resolved = resolveCapabilityMatrix({
      current,
      initiator,
      channelKind,
      enforceChannel,
      docsMaintenanceReady: setup.docsMaintenanceReady,
      githubWritebackReady: setup.githubWritebackReady,
      preparedDraftReady: preparedDraftIsReady(),
      watchReservationId: reservationId,
      watchAuthority,
    });
    await persistResolution(session, turnId, resolved);
    return resolved;
  } catch {
    const failed = resolveCapabilityMatrix({
      current,
      initiator,
      channelKind,
      enforceChannel,
      docsMaintenanceReady: false,
      githubWritebackReady: false,
      preparedDraftReady: false,
      watchReservationId: reservationId,
      watchAuthority: null,
      resolverFailed: true,
    });
    try {
      await persistResolution(session, turnId, failed);
    } catch {
      // The resolver remains fail-closed when its durable projection is unavailable.
    }
    return failed;
  }
}

async function persistResolution(
  session: ResolverSession,
  turnId: string,
  resolved: CapabilityResolution,
): Promise<void> {
  await recordCapabilityResolution({
    sessionId: session.id,
    turnId,
    contextClass: resolved.contextClass,
    status: resolved.status,
    capabilityFamilies: [...resolved.capabilityFamilies],
    toolNames: [...resolved.toolNames],
    reasonCodes: [...resolved.reasonCodes],
    reservationId: resolved.reservationId,
    watchId: resolved.watchId,
    effectiveRevisionId: resolved.effectiveRevisionId,
  });
}

function turnIdFromEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null || !("data" in event)) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null || !("turnId" in data)) return null;
  return typeof data.turnId === "string" && data.turnId.length > 0 ? data.turnId : null;
}

function resolution(
  contextClass: CapabilityContextClass,
  families: Set<CapabilityFamily>,
  tools: Set<AuthoredToolName>,
  reasons: Set<CapabilityResolutionReason>,
  input: CapabilityMatrixInput,
): CapabilityResolution {
  return {
    contextClass,
    status: tools.size === 0 ? "denied" : "resolved",
    capabilityFamilies: [...families].sort(),
    toolNames: [...tools].sort(),
    reasonCodes: [...reasons].sort(),
    reservationId: input.watchAuthority?.reservationId ?? input.watchReservationId,
    watchId: input.watchAuthority?.watchId ?? null,
    effectiveRevisionId: input.watchAuthority?.effectiveRevisionId ?? null,
  };
}

function classifyContext(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
  reservationId: string | null,
  channelKind: string | null,
  enforceChannel: boolean,
): CapabilityContextClass {
  const channelMatches = (...expected: string[]) =>
    !enforceChannel || (channelKind !== null && expected.includes(channelKind));
  if (reservationId !== null && channelMatches("chat-sdk", "channel:slack")) return "watch";
  if (
    isSchedulePrincipal(current) &&
    isSchedulePrincipal(initiator) &&
    channelMatches("schedule")
  ) return "schedule";
  if (
    isSlackPrincipal(current) &&
    isSlackPrincipal(initiator) &&
    current.issuer === initiator.issuer &&
    channelMatches("chat-sdk", "channel:slack")
  ) return "slack";
  if (
    isLinearPrincipal(current) &&
    isLinearPrincipal(initiator) &&
    current.issuer === initiator.issuer &&
    channelMatches("linear", "channel:linear")
  ) return "linear";
  if (
    isInteractivePrincipalPair(current, initiator) &&
    channelMatches("http", "channel:eve")
  ) return "eve";
  return "unknown";
}

function projectPrincipal(value: unknown): PrincipalProjection {
  if (typeof value !== "object" || value === null) {
    return { principalId: null, principalType: null, authenticator: null, issuer: null };
  }
  const principal = value as Record<string, unknown>;
  return {
    principalId: typeof principal.principalId === "string" ? principal.principalId : null,
    principalType: typeof principal.principalType === "string" ? principal.principalType : null,
    authenticator: typeof principal.authenticator === "string" ? principal.authenticator : null,
    issuer: typeof principal.issuer === "string" ? principal.issuer : null,
  };
}

function watchReservationId(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
): string | null {
  const prefix = "paige:watch-dispatch:";
  if (
    current.principalType !== "runtime" ||
    initiator.principalType !== "runtime" ||
    current.authenticator !== "paige-watch-dispatch" ||
    initiator.authenticator !== "paige-watch-dispatch" ||
    current.issuer !== "paige" ||
    initiator.issuer !== "paige" ||
    current.principalId !== initiator.principalId ||
    !current.principalId?.startsWith(prefix)
  ) return null;
  const reservationId = current.principalId.slice(prefix.length);
  return /^[a-f0-9]{64}$/u.test(reservationId) ? reservationId : null;
}

function isSchedulePrincipal(principal: PrincipalProjection): boolean {
  return principal.authenticator === "app" &&
    principal.principalType === "runtime" &&
    principal.principalId === "eve:app";
}

function isSlackPrincipal(principal: PrincipalProjection): boolean {
  return principal.principalType === "user" &&
    principal.authenticator === "slack-webhook" &&
    principal.issuer?.startsWith("slack:") === true &&
    principal.principalId?.startsWith("slack:") === true;
}

function isLinearPrincipal(principal: PrincipalProjection): boolean {
  return principal.principalType === "user" &&
    principal.authenticator === "linear-agent-webhook" &&
    principal.issuer?.startsWith("linear:") === true &&
    principal.principalId?.startsWith("linear:") === true;
}

export async function canExecuteApprovedPublicationResume(
  input: {
    readonly toolName: AuthoredToolName;
    readonly current: PrincipalProjection;
    readonly initiator: PrincipalProjection;
    readonly preparedDraftReady: boolean;
    readonly sessionId: string;
    readonly runId: string;
    readonly callId: string;
  },
  dependencies: {
    readonly checkApprovedResume: typeof hasApprovedToolResume;
    readonly recordResolution: typeof recordCapabilityResolution;
  } = {
    checkApprovedResume: hasApprovedToolResume,
    recordResolution: recordCapabilityResolution,
  },
): Promise<boolean> {
  const allowed = input.toolName === "publish_working_repository_pr" &&
    input.preparedDraftReady &&
    isOperatorApprovalResumeContext(input.current, input.initiator) &&
    await dependencies.checkApprovedResume({
      sessionId: input.sessionId,
      runId: input.runId,
      callId: input.callId,
      toolName: input.toolName,
    });
  if (!allowed) return false;
  await dependencies.recordResolution({
    sessionId: input.sessionId,
    turnId: input.runId,
    contextClass: "approval-resume",
    status: "resolved",
    capabilityFamilies: ["publication.publish"],
    toolNames: ["publish_working_repository_pr"],
    reasonCodes: ["approved-publication-resume"],
    reservationId: null,
    watchId: null,
    effectiveRevisionId: null,
  });
  return true;
}

export function isOperatorApprovalResumeContext(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
): boolean {
  const currentIsOperatorRuntime = current.authenticator === "oidc" &&
    current.principalType === "runtime" &&
    current.principalId !== null &&
    current.issuer?.startsWith("https://oidc.vercel.com/") === true;
  const humanInitiator = isSlackPrincipal(initiator) ||
    isLinearPrincipal(initiator) ||
    isInteractivePrincipalPair(initiator, initiator);
  return currentIsOperatorRuntime &&
    humanInitiator &&
    !isSchedulePrincipal(initiator) &&
    watchReservationId(current, initiator) === null;
}

function isInteractivePrincipalPair(
  current: PrincipalProjection,
  initiator: PrincipalProjection,
): boolean {
  const local = (principal: PrincipalProjection) =>
    principal.authenticator === "local-dev" &&
    principal.principalId === "local-dev" &&
    principal.principalType === "local-dev" &&
    principal.issuer === null;
  if (local(current) && local(initiator)) return true;

  const oidc = (principal: PrincipalProjection) =>
    principal.authenticator === "oidc" &&
    principal.principalType === "user" &&
    principal.principalId !== null &&
    principal.issuer?.startsWith("https://oidc.vercel.com/") === true;
  return oidc(current) && oidc(initiator) && current.issuer === initiator.issuer;
}

function preparedDraftIsReady(): boolean {
  const state = inspectRepositoryWorkflowState();
  const draft = state?.draft;
  const result = state?.lastResult;
  return draft?.status === "prepared" &&
    draft.preparedAt !== undefined &&
    draft.preparedDiffHash !== undefined &&
    result?.ok === true &&
    result.preparedAt === draft.preparedAt &&
    result.preparedDiffHash === draft.preparedDiffHash &&
    result.report.checks.every(({ status }) => status === "passed") &&
    result.changedFiles.length > 0 &&
    result.diff.length > 0;
}
