import "server-only";

import {
  getOperatorKnowledgeSources,
  operatorKnowledgeSourcesSchema,
  type OperatorKnowledgeSources,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_SOURCE_TEST_SCENARIOS";

export type KnowledgeSourcesResult =
  | { state: "ready"; report: OperatorKnowledgeSources }
  | { state: "invalid-record" }
  | { state: "database-error" };

export async function resolveKnowledgeSources(
  requestedScenario?: string,
): Promise<KnowledgeSourcesResult> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    if (requestedScenario === "invalid-record") return { state: "invalid-record" };
    if (requestedScenario === "database-error") return { state: "database-error" };
    if (requestedScenario === "unconfigured") {
      return {
        state: "ready",
        report: operatorKnowledgeSourcesSchema.parse({
          state: "unconfigured",
          summary: "Workspace setup has no configured knowledge-source registry yet.",
          sources: [],
        }),
      };
    }
    return { state: "ready", report: fixtureKnowledgeSources() };
  }

  try {
    return { state: "ready", report: await getOperatorKnowledgeSources() };
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return { state: "invalid-record" };
    return { state: "database-error" };
  }
}

function fixtureKnowledgeSources(): OperatorKnowledgeSources {
  return operatorKnowledgeSourcesSchema.parse({
    state: "ready",
    summary: "3 configured knowledge sources. Repository revisions resolve on verified reads rather than from browser input.",
    sources: [
      source({
        sourceId: "working-documentation",
        kind: "working-documentation",
        displayName: "Working documentation",
        provenanceLabel: "working-documentation",
        evidenceClass: "current-documentation",
        url: "https://github.com/peelar/saleor-docs",
        requestedRef: "main",
        resolvedRevision: "a".repeat(40),
        observedAt: "2026-07-15T08:00:00.000Z",
        draftMutation: "working-documentation-only",
      }),
      source({
        sourceId: "watched:saleor",
        kind: "watched-repository",
        displayName: "Saleor",
        provenanceLabel: "watched-repository:saleor/saleor",
        evidenceClass: "source-code-or-merged-change",
        url: "https://github.com/saleor/saleor",
        requestedRef: "main",
        resolvedRevision: null,
        observedAt: null,
        draftMutation: "none",
      }),
      source({
        sourceId: "context:decisions",
        kind: "context-repository",
        displayName: "Product decisions",
        provenanceLabel: "context-repository:peelar/product-decisions",
        evidenceClass: "maintainer-confirmed-product-decision",
        url: "https://github.com/peelar/product-decisions",
        requestedRef: "main",
        resolvedRevision: null,
        observedAt: null,
        draftMutation: "none",
      }),
    ],
  });
}

function source(input: {
  sourceId: string;
  kind: "working-documentation" | "watched-repository" | "context-repository";
  displayName: string;
  provenanceLabel: string;
  evidenceClass: string;
  url: string;
  requestedRef: string;
  resolvedRevision: string | null;
  observedAt: string | null;
  draftMutation: "working-documentation-only" | "none";
}) {
  return {
    sourceId: input.sourceId,
    kind: input.kind,
    displayName: input.displayName,
    description: "Configured workspace knowledge source.",
    provenanceLabel: input.provenanceLabel,
    evidenceClass: input.evidenceClass,
    canSupportPublicDocsClaim: true,
    readiness: {
      status: input.resolvedRevision === null ? "configured" : "ready",
      detail: input.resolvedRevision === null
        ? "Provider access and revision are checked on first read."
        : "Access and revision were verified by a repository read.",
      access: input.resolvedRevision === null ? "not-checked" : "github-app",
    },
    repository: {
      url: input.url,
      requestedRef: input.requestedRef,
      resolvedRevision: input.resolvedRevision,
      observedAt: input.observedAt,
      pathFilters: [],
    },
    authority: {
      readActions: ["list", "search", "read"],
      draftMutation: input.draftMutation,
      explanation: input.draftMutation === "none"
        ? "This source is read-only and cannot reach drafting or publication."
        : "This is the only repository eligible for reversible draft edits. Publication remains separately approval gated.",
    },
    retention: "Returned excerpts remain bounded turn evidence.",
    contentTrust: "untrusted-data",
  };
}
