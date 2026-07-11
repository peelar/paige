import { z } from "zod";

export const WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH = "/workspace/working-docs";
export const WORKING_DOCUMENTATION_REPOSITORY_PROVENANCE_LABEL =
  "working-documentation-repository";
export const DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF = "main";
export const WATCHED_REPOSITORY_SANDBOX_PATH_PREFIX = "/workspace/watched";

export const GITHUB_SANDBOX_NETWORK_ALLOWLIST = [
  "github.com",
  "*.github.com",
  "githubusercontent.com",
  "*.githubusercontent.com",
] as const;

export const PACKAGE_MANAGER_SANDBOX_NETWORK_ALLOWLIST = [
  "registry.npmjs.org",
  "*.npmjs.org",
] as const;

export const WORKING_REPOSITORY_SANDBOX_NETWORK_ALLOWLIST = [
  ...GITHUB_SANDBOX_NETWORK_ALLOWLIST,
  ...PACKAGE_MANAGER_SANDBOX_NETWORK_ALLOWLIST,
] as const;

const githubRepositoryUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      const pathParts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);

      return url.protocol === "https:" && url.hostname === "github.com" && pathParts.length === 2;
    } catch {
      return false;
    }
  }, "Use an https://github.com/<owner>/<repo>[.git] URL.");

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (path) =>
      path === "." ||
      (!path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..")),
    "Use a repository-relative path.",
  );

const sandboxPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (path) =>
      path === WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH ||
      (path.startsWith("/workspace/") && !path.split("/").includes("..")),
    "Use an absolute path under /workspace.",
  );

const provenanceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use a lowercase dash-separated label.");

const watchedRepositoryProvenanceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^watched-repository:[a-z0-9_.-]+\/[a-z0-9_.-]+$/,
    "Use a watched-repository:<owner>/<repo> label.",
  );

const repositoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use a lowercase dash-separated id.");

export const githubRepositorySourceSchema = z.object({
  type: z.literal("github-url"),
  url: githubRepositoryUrlSchema,
});

export const workingRepositoryActionSchema = z.enum([
  "clone",
  "read",
  "search",
  "patch",
  "run-checks",
  "export-diff",
  "publish-pr",
]);

export const contextRepositoryActionSchema = z.enum([
  "clone",
  "read",
  "search",
  "inspect-diff",
  "run-readonly-checks",
]);

export const watchedRepositoryActionSchema = z.enum([
  "clone",
  "read",
  "search",
  "inspect-diff",
  "run-readonly-checks",
]);

export const watchedRepositorySignalSchema = z.enum(["releases", "pull-requests", "issues"]);

export const workingDocumentationRepositorySchema = z.object({
  source: githubRepositorySourceSchema,
  ref: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF)
    .describe("Branch, tag, or commit to inspect. Defaults to main when omitted."),
  docsRoot: repositoryRelativePathSchema
    .optional()
    .describe("Repository-relative docs root. Omit it to detect the docs root after cloning."),
  sandboxPath: sandboxPathSchema.default(WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH),
  accessMode: z.literal("sandbox-write").default("sandbox-write"),
  allowedActions: z
    .array(workingRepositoryActionSchema)
    .nonempty()
    .default(["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"]),
  provenanceLabel: provenanceLabelSchema.default(WORKING_DOCUMENTATION_REPOSITORY_PROVENANCE_LABEL),
});

export const contextRepositorySchema = z.object({
  source: githubRepositorySourceSchema,
  ref: z.string().trim().min(1),
  sandboxPath: sandboxPathSchema,
  accessMode: z.literal("sandbox-read").default("sandbox-read"),
  pathFilters: z.array(repositoryRelativePathSchema).default([]),
  allowedActions: z
    .array(contextRepositoryActionSchema)
    .nonempty()
    .default(["clone", "read", "search", "inspect-diff"]),
  provenanceLabel: provenanceLabelSchema,
});

export const watchedRepositorySchema = z.object({
  id: repositoryIdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  importance: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  source: githubRepositorySourceSchema,
  defaultRef: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_WORKING_DOCUMENTATION_REPOSITORY_REF)
    .describe("Default branch, tag, or commit to inspect when a signal has no exact ref."),
  sandboxPath: sandboxPathSchema.refine(
    (path) => path.startsWith(`${WATCHED_REPOSITORY_SANDBOX_PATH_PREFIX}/`),
    `Use an absolute path under ${WATCHED_REPOSITORY_SANDBOX_PATH_PREFIX}.`,
  ),
  accessMode: z.literal("sandbox-read").default("sandbox-read"),
  allowedActions: z
    .array(watchedRepositoryActionSchema)
    .nonempty()
    .default(["clone", "read", "search", "inspect-diff", "run-readonly-checks"]),
  pathFilters: z.array(repositoryRelativePathSchema).default([]),
  signals: z.array(watchedRepositorySignalSchema).nonempty().default(["releases"]),
  provenanceLabel: watchedRepositoryProvenanceLabelSchema,
});

const externalContextBaseSchema = z.object({
  sourceId: z.string().trim().min(1),
  permalink: z.string().url().optional(),
  capturedAt: z.string().trim().min(1).optional(),
});

export const communicationMessageSchema = z.object({
  author: z.string().trim().min(1),
  body: z.string().trim().min(1),
  timestamp: z.string().trim().min(1),
  permalink: z.string().url().optional(),
});

export const externalContextSchema = z.discriminatedUnion("kind", [
  externalContextBaseSchema.extend({
    kind: z.literal("communication-thread"),
    title: z.string().trim().min(1),
    participants: z.array(z.string().trim().min(1)).default([]),
    messages: z.array(communicationMessageSchema).nonempty(),
    relatedReferences: z.array(z.string().trim().min(1)).default([]),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("issue-tracker-item"),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    status: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    assignee: z.string().trim().min(1).optional(),
    labels: z.array(z.string().trim().min(1)).default([]),
    relationships: z.array(z.string().trim().min(1)).default([]),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("decision-record"),
    title: z.string().trim().min(1),
    decision: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    author: z.string().trim().min(1).optional(),
    decidedAt: z.string().trim().min(1).optional(),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("release-note"),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    releasedAt: z.string().trim().min(1).optional(),
    relevance: z.string().trim().min(1).optional(),
  }),
  externalContextBaseSchema.extend({
    kind: z.literal("customer-report"),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    reportedAt: z.string().trim().min(1).optional(),
    relevance: z.string().trim().min(1).optional(),
  }),
]);

export const repositoryInputSchema = z.object({
  workingDocumentationRepository: workingDocumentationRepositorySchema,
  watchedRepositories: z.array(watchedRepositorySchema).default([]),
  contextRepositories: z.array(contextRepositorySchema).default([]),
  externalContext: z.array(externalContextSchema).default([]),
});

export type GitHubRepositorySource = z.infer<typeof githubRepositorySourceSchema>;
export type WorkingDocumentationRepository = z.infer<typeof workingDocumentationRepositorySchema>;
export type ContextRepository = z.infer<typeof contextRepositorySchema>;
export type WatchedRepository = z.infer<typeof watchedRepositorySchema>;
export type ExternalContext = z.infer<typeof externalContextSchema>;
export type RepositoryInput = z.infer<typeof repositoryInputSchema>;
export type ResolvedWorkingDocumentationRepository = WorkingDocumentationRepository & {
  docsRoot: string;
};
export type ResolvedRepositoryInput = Omit<RepositoryInput, "workingDocumentationRepository"> & {
  workingDocumentationRepository: ResolvedWorkingDocumentationRepository;
};
