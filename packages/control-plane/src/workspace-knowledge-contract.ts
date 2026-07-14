import { z } from "zod";

import type { RepositoryInput } from "./repository-contract.ts";

export const workspaceKnowledgeSourceKindSchema = z.enum([
  "working-documentation",
  "watched-repository",
  "context-repository",
  "release-feed",
  "provider-context",
  "web",
  "workspace-memory",
]);

export const workspaceKnowledgeEvidenceClassSchema = z.enum([
  "current-documentation",
  "source-code-or-merged-change",
  "official-release",
  "maintainer-confirmed-product-decision",
  "provider-conversation-context",
  "workspace-memory",
  "external-web-result",
]);

export const workspaceKnowledgeAccessModeSchema = z.enum([
  "sandbox-write",
  "sandbox-read",
  "provider-read",
  "public-read",
  "memory-read",
]);

export const workspaceKnowledgeReadActionSchema = z.enum([
  "list",
  "search",
  "read",
]);

export const workspaceKnowledgeSourceReadinessSchema = z.object({
  status: z.enum([
    "configured",
    "ready",
    "missing-auth",
    "stale",
    "rate-limited",
    "unavailable",
  ]),
  detail: z.string().trim().min(1),
  access: z.enum(["not-checked", "github-app", "public-github", "provider", "local"]),
});

const workspaceKnowledgeSourceBaseSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  workspaceId: z.string().trim().min(1),
  kind: workspaceKnowledgeSourceKindSchema,
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  accessMode: workspaceKnowledgeAccessModeSchema,
  allowedReadActions: z.array(workspaceKnowledgeReadActionSchema).min(1),
  repository: z.object({
    url: z.string().url(),
    requestedRef: z.string().trim().min(1),
    sandboxPath: z.string().trim().min(1),
    pathFilters: z.array(z.string()),
  }).optional(),
  provenanceLabel: z.string().trim().min(1),
  evidenceClass: workspaceKnowledgeEvidenceClassSchema,
  canSupportPublicDocsClaim: z.boolean(),
  freshness: z.object({
    requestedRef: z.string().trim().min(1).optional(),
    resolvedRevision: z.string().trim().min(1).nullable(),
    observedAt: z.string().datetime().nullable(),
  }),
  readiness: workspaceKnowledgeSourceReadinessSchema,
  retention: z.object({
    mode: z.enum(["turn-only", "source-governed"]),
    detail: z.string().trim().min(1),
  }),
  modelOutput: z.object({
    maxSearchMatches: z.number().int().min(1).max(100),
    maxExcerptCharacters: z.number().int().min(1).max(2_000),
    maxReadCharacters: z.number().int().min(1).max(24_000),
  }),
  contentTrust: z.literal("untrusted-data"),
});

export const workspaceKnowledgeSourceSchema = workspaceKnowledgeSourceBaseSchema.superRefine(
  validateSourcePolicy,
);

export const workspaceKnowledgeSourceReferenceSchema = workspaceKnowledgeSourceBaseSchema
  .omit({ workspaceId: true })
  .superRefine(validateSourcePolicy);

export type WorkspaceKnowledgeSource = z.infer<typeof workspaceKnowledgeSourceSchema>;
export type WorkspaceKnowledgeSourceReference = z.infer<
  typeof workspaceKnowledgeSourceReferenceSchema
>;
export type WorkspaceKnowledgeEvidenceClass = z.infer<
  typeof workspaceKnowledgeEvidenceClassSchema
>;

export function normalizeWorkspaceKnowledgeLink(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  if (url.hostname === "github.com") {
    url.pathname = url.pathname.replace(/\.git$/u, "").replace(/\/+$/u, "");
  }
  return url.toString().replace(/\/$/u, "");
}

const repositorySourcePolicy = {
  allowedReadActions: ["list", "search", "read"] as const,
  readiness: {
    status: "configured" as const,
    detail: "Repository identity is configured; provider access and the resolved revision are checked on first read.",
    access: "not-checked" as const,
  },
  retention: {
    mode: "turn-only" as const,
    detail: "Returned excerpts remain bounded turn evidence; repository contents are not copied into product persistence.",
  },
  modelOutput: {
    maxSearchMatches: 50,
    maxExcerptCharacters: 500,
    maxReadCharacters: 24_000,
  },
  contentTrust: "untrusted-data" as const,
};

const policyByKind = {
  "working-documentation": {
    accessModes: ["sandbox-write"],
    evidenceClasses: ["current-documentation"],
    repository: true,
  },
  "watched-repository": {
    accessModes: ["sandbox-read"],
    evidenceClasses: ["source-code-or-merged-change"],
    repository: true,
  },
  "context-repository": {
    accessModes: ["sandbox-read"],
    evidenceClasses: [
      "source-code-or-merged-change",
      "maintainer-confirmed-product-decision",
    ],
    repository: true,
  },
  "release-feed": {
    accessModes: ["provider-read", "public-read"],
    evidenceClasses: ["official-release"],
    repository: false,
  },
  "provider-context": {
    accessModes: ["provider-read"],
    evidenceClasses: [
      "provider-conversation-context",
      "maintainer-confirmed-product-decision",
    ],
    repository: false,
  },
  web: {
    accessModes: ["public-read"],
    evidenceClasses: ["external-web-result"],
    repository: false,
  },
  "workspace-memory": {
    accessModes: ["memory-read"],
    evidenceClasses: ["workspace-memory"],
    repository: false,
  },
} as const;

function validateSourcePolicy(
  source: z.infer<typeof workspaceKnowledgeSourceBaseSchema> | Omit<
    z.infer<typeof workspaceKnowledgeSourceBaseSchema>,
    "workspaceId"
  >,
  ctx: z.RefinementCtx,
): void {
  const policy = policyByKind[source.kind];
  if (!(policy.accessModes as readonly string[]).includes(source.accessMode)) {
    ctx.addIssue({
      code: "custom",
      path: ["accessMode"],
      message: `Access mode ${source.accessMode} is not allowed for ${source.kind}.`,
    });
  }
  if (!(policy.evidenceClasses as readonly string[]).includes(source.evidenceClass)) {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceClass"],
      message: `Evidence class ${source.evidenceClass} is not allowed for ${source.kind}.`,
    });
  }
  if (policy.repository !== (source.repository !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["repository"],
      message: policy.repository
        ? `${source.kind} requires repository policy.`
        : `${source.kind} cannot carry repository policy.`,
    });
  }
  if (
    source.canSupportPublicDocsClaim &&
    ["provider-conversation-context", "workspace-memory", "external-web-result"].includes(
      source.evidenceClass,
    )
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["canSupportPublicDocsClaim"],
      message: `${source.evidenceClass} cannot independently support a public documentation claim.`,
    });
  }
}

export function buildWorkspaceKnowledgeSourceRegistry(input: {
  workspaceId: string;
  repositoryInput: RepositoryInput;
}): WorkspaceKnowledgeSource[] {
  const working = input.repositoryInput.workingDocumentationRepository;
  const sources: WorkspaceKnowledgeSource[] = [workspaceKnowledgeSourceSchema.parse({
    ...repositorySourcePolicy,
    sourceId: "working-documentation",
    workspaceId: input.workspaceId,
    kind: "working-documentation",
    displayName: "Working documentation",
    description: "The configured documentation repository and the only mutable repository target.",
    accessMode: working.accessMode,
    repository: {
      url: normalizeWorkspaceKnowledgeLink(working.source.url),
      requestedRef: working.ref,
      sandboxPath: working.sandboxPath,
      pathFilters: working.docsRoot === undefined ? [] : [working.docsRoot],
    },
    provenanceLabel: working.provenanceLabel,
    evidenceClass: "current-documentation",
    canSupportPublicDocsClaim: true,
    freshness: {
      requestedRef: working.ref,
      resolvedRevision: null,
      observedAt: null,
    },
  })];

  for (const repository of input.repositoryInput.watchedRepositories) {
    sources.push(workspaceKnowledgeSourceSchema.parse({
      ...repositorySourcePolicy,
      sourceId: `watched:${repository.id}`,
      workspaceId: input.workspaceId,
      kind: "watched-repository",
      displayName: repository.name,
      description: repository.description,
      accessMode: repository.accessMode,
      repository: {
        url: normalizeWorkspaceKnowledgeLink(repository.source.url),
        requestedRef: repository.defaultRef,
        sandboxPath: repository.sandboxPath,
        pathFilters: repository.pathFilters,
      },
      provenanceLabel: repository.provenanceLabel,
      evidenceClass: "source-code-or-merged-change",
      canSupportPublicDocsClaim: true,
      freshness: {
        requestedRef: repository.defaultRef,
        resolvedRevision: null,
        observedAt: null,
      },
    }));
  }

  for (const repository of input.repositoryInput.contextRepositories) {
    sources.push(workspaceKnowledgeSourceSchema.parse({
      ...repositorySourcePolicy,
      sourceId: `context:${repository.id}`,
      workspaceId: input.workspaceId,
      kind: "context-repository",
      displayName: repository.name,
      description: repository.description,
      accessMode: repository.accessMode,
      repository: {
        url: normalizeWorkspaceKnowledgeLink(repository.source.url),
        requestedRef: repository.ref,
        sandboxPath: repository.sandboxPath,
        pathFilters: repository.pathFilters,
      },
      provenanceLabel: repository.provenanceLabel,
      evidenceClass: repository.evidenceClass,
      canSupportPublicDocsClaim: repository.canSupportPublicDocsClaim,
      freshness: {
        requestedRef: repository.ref,
        resolvedRevision: null,
        observedAt: null,
      },
    }));
  }

  const identities = sources.map(({ sourceId }) => sourceId);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Workspace knowledge sources must have unique stable identities.");
  }
  return sources;
}

export function projectWorkspaceKnowledgeSource(
  source: WorkspaceKnowledgeSource,
): WorkspaceKnowledgeSourceReference {
  const { workspaceId: _workspaceId, ...reference } = source;
  return workspaceKnowledgeSourceReferenceSchema.parse(reference);
}
