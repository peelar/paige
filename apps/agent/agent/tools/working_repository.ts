import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import {
  WorkingRepositoryService,
  workingRepositoryListEntrySchema,
  workingRepositoryReferenceSchema,
  workingRepositorySearchMatchSchema,
  workingRepositoryValidationProfileSchema,
  workingRepositoryValidatorResultSchema,
} from "../lib/working-repository-service";
import { repositoryActionRecordSchema } from "../lib/repository-materialization";
import { saveRepositoryWorkflowState } from "../lib/repository-workflow-state";
import { repositoryMaterializationSchema } from "../lib/repository-workflow-contract";
import { requireSetupReady } from "../lib/setup-state";
import {
  loadOrMaterializeRepositoryWorkflowState,
  runWorkingRepositoryOperationSerially,
  workingRepositoryOperationKey,
} from "../lib/working-repository-lifecycle";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

const workingRepositoryValidatorIdSchema = z.string().trim().min(1).max(160);
const workingRepositoryValidatorIdListSchema = z
  .array(workingRepositoryValidatorIdSchema)
  .min(1)
  .max(5);
export const workingRepositoryValidatorIdsInputSchema =
  workingRepositoryValidatorIdListSchema;

const ensureInputSchema = z.object({ mode: z.literal("ensure") });
const listInputSchema = z.object({
  mode: z.literal("list"),
  pathPrefix: z.string().default("."),
  pattern: z.string().default("**/*"),
  limit: z.number().int().min(1).max(200).default(100),
  maxDepth: z.number().int().min(0).max(8).default(4),
});
const searchInputSchema = z.object({
  mode: z.literal("search"),
  query: z.string().min(1).max(500),
  kind: z.enum(["literal", "regex"]).default("literal"),
  caseSensitive: z.boolean().default(false),
  pathPrefix: z.string().default("."),
  pattern: z.string().default("**/*"),
  limit: z.number().int().min(1).max(100).default(50),
});
const readInputSchema = z.object({
  mode: z.literal("read"),
  path: z.string().min(1),
  startLine: z.number().int().positive().default(1),
  endLine: z.number().int().positive().optional(),
  maxCharacters: z.number().int().min(1).max(24_000).default(24_000),
});
const statusInputSchema = z.object({ mode: z.literal("status") });
const diffInputSchema = z.object({
  mode: z.literal("diff"),
  maxCharacters: z.number().int().min(1).max(50_000).default(50_000),
});
const validatorsInputSchema = z.object({ mode: z.literal("validators") });
const runValidatorsInputSchema = z.object({
  mode: z.literal("run_validators"),
  validatorIds: workingRepositoryValidatorIdsInputSchema,
});

const workingRepositoryModeInputSchema = z.discriminatedUnion("mode", [
  ensureInputSchema,
  listInputSchema,
  searchInputSchema,
  readInputSchema,
  statusInputSchema,
  diffInputSchema,
  validatorsInputSchema,
  runValidatorsInputSchema,
]);

/**
 * Keep argument types visible in top-level JSON Schema `properties` for model
 * providers while preserving the existing mode-specific contract via `pipe`.
 */
export const workingRepositoryInputSchema = z.object({
  mode: z.enum([
    "ensure",
    "list",
    "search",
    "read",
    "status",
    "diff",
    "validators",
    "run_validators",
  ]),
  pathPrefix: listInputSchema.shape.pathPrefix.removeDefault().optional(),
  pattern: listInputSchema.shape.pattern.removeDefault().optional(),
  // `limit` has different ceilings for list (200) and search (100). Keep the
  // provider-facing property typed without advertising one mode's ceiling as
  // universal; the piped mode schema remains the fail-closed authority.
  limit: z.number().int().min(1).optional(),
  maxDepth: listInputSchema.shape.maxDepth.removeDefault().optional(),
  query: searchInputSchema.shape.query.optional(),
  kind: searchInputSchema.shape.kind.removeDefault().optional(),
  caseSensitive: searchInputSchema.shape.caseSensitive.removeDefault().optional(),
  path: readInputSchema.shape.path.optional(),
  startLine: readInputSchema.shape.startLine.removeDefault().optional(),
  endLine: readInputSchema.shape.endLine.optional(),
  // `maxCharacters` is likewise mode-specific: read allows 24,000 while diff
  // allows 50,000. The mode schema below enforces the applicable ceiling.
  maxCharacters: z.number().int().min(1).optional(),
  validatorIds: workingRepositoryValidatorIdsInputSchema.optional(),
}).strict().pipe(workingRepositoryModeInputSchema);

const commonOutput = {
  repository: workingRepositoryReferenceSchema,
  actions: z.array(repositoryActionRecordSchema).max(20),
};

const outputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ensure"),
    ...commonOutput,
    materialization: repositoryMaterializationSchema,
  }),
  z.object({
    mode: z.literal("list"),
    ...commonOutput,
    entries: z.array(workingRepositoryListEntrySchema),
    truncated: z.boolean(),
    omittedSymlinks: z.number().int().nonnegative(),
    examined: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal("search"),
    ...commonOutput,
    matches: z.array(workingRepositorySearchMatchSchema),
    truncated: z.boolean(),
    searchedFiles: z.number().int().nonnegative(),
    skippedLargeFiles: z.number().int().nonnegative(),
    omittedSymlinks: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal("read"),
    ...commonOutput,
    path: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    content: z.string().nullable(),
    binary: z.boolean(),
    truncated: z.boolean(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal("status"),
    ...commonOutput,
    status: z.string(),
    changedFiles: z.array(z.string()),
    clean: z.boolean(),
    truncated: z.boolean(),
  }),
  z.object({
    mode: z.literal("diff"),
    ...commonOutput,
    diff: z.string(),
    changedFiles: z.array(z.string()),
    noDiff: z.boolean(),
    truncated: z.boolean(),
  }),
  z.object({
    mode: z.literal("validators"),
    ...commonOutput,
    executed: z.literal(false),
    requiredNextMode: z.literal("run_validators"),
    profile: workingRepositoryValidationProfileSchema,
  }),
  z.object({
    mode: z.literal("run_validators"),
    ...commonOutput,
    executed: z.literal(true),
    profile: workingRepositoryValidationProfileSchema,
    results: z.array(workingRepositoryValidatorResultSchema),
  }),
]);

export function workingRepositoryModelOutput(output: z.infer<typeof outputSchema>) {
  if (output.mode === "validators") {
    return {
      type: "json" as const,
      value: {
        mode: output.mode,
        executed: output.executed,
        requiredNextMode: output.requiredNextMode,
        repository: output.repository,
        validators: output.profile.validators.map(({ id, label, executable, owner, sources }) => ({
          id,
          label,
          executable,
          owner,
          sources,
        })),
        followUps: output.profile.validators
          .filter(({ executable }) => executable)
          .slice(0, 30)
          .map(({ id }) => ({
            id,
            input: { mode: "run_validators" as const, validatorIds: [id] },
          })),
        instruction:
          "No validators ran. run_validators is read-only inspection: it executes only trusted previously disclosed ids internally, accepts no command, and does not mutate the repository. To execute a requested check, call working_repository now with mode run_validators and validatorIds containing only returned ids. Do not substitute status or diff for validator execution.",
      },
    };
  }
  if (output.mode === "run_validators") {
    return {
      type: "json" as const,
      value: {
        mode: output.mode,
        executed: output.executed,
        repository: output.repository,
        discovery: {
          repository: output.profile.repository,
          validators: output.profile.validators.map(({ id, executable, owner, sources }) => ({
            id,
            status: executable ? "available" : "denied",
            provenance: { owner, sources },
          })),
        },
        results: output.results.map(({ id, status, exitCode, stdout, stderr, truncated, provenance, sources }) => ({
          id,
          status,
          exitCode,
          stdout,
          stderr,
          truncated,
          provenance,
          sources,
        })),
      },
    };
  }
  return { type: "json" as const, value: output };
}

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("working_repository")) return null;
  return defineTool({
  description:
    "Inspect the configured working documentation repository through one policy-aware read capability. It materializes setup implicitly, lists safe paths, searches bounded text, reads line ranges, and returns bounded binary metadata with a full-file SHA-256 hash and null content. Use that hash as the authoring precondition for existing text or binary files. Validators mode optionally lists ids and does not run checks. run_validators is atomic read-only inspection: it discovers and persists the current source-bound trusted profile, executes only requested ids from that profile, accepts no command, and does not mutate the repository.",
  inputSchema: workingRepositoryInputSchema,
  outputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("working_repository", ctx);
    const setup = await requireSetupReady("docs-maintenance");
    const configuredRepository = setup.workingRepositoryInput.workingDocumentationRepository;
    const operationKey = workingRepositoryOperationKey(ctx.session.id, configuredRepository);
    return runWorkingRepositoryOperationSerially(
      operationKey,
      async () => {
        const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
        const service = new WorkingRepositoryService({
          ctx,
          repository: state.repositoryInput.workingDocumentationRepository,
          materialization: state.materialization,
          actionProvenance: state.actionProvenance,
          validationProfile: state.repositoryValidationProfile,
          onValidationProfile(profile) {
            state.repositoryValidationProfile = profile;
          },
        });
        const finish = async <T extends Record<string, unknown>>(output: T) => {
          await saveRepositoryWorkflowState(state);
          return {
            ...output,
            repository: service.reference,
            actions: state.actionProvenance.slice(-20),
          };
        };

        switch (input.mode) {
          case "ensure":
            return finish({ mode: input.mode, materialization: state.materialization });
          case "list":
            return finish({ mode: input.mode, ...(await service.list(input)) });
          case "search":
            return finish({ mode: input.mode, ...(await service.search(input)) });
          case "read":
            return finish({ mode: input.mode, ...(await service.read(input)) });
          case "status":
            return finish({ mode: input.mode, ...(await service.status()) });
          case "diff":
            return finish({ mode: input.mode, ...(await service.diff(input.maxCharacters)) });
          case "validators":
            return finish({
              mode: input.mode,
              executed: false as const,
              requiredNextMode: "run_validators" as const,
              profile: await service.validators(),
            });
          case "run_validators": {
            const validation = await service.runValidators(input.validatorIds);
            return finish({
              mode: input.mode,
              executed: true as const,
              ...validation,
            });
          }
        }
      },
    );
  },
  toModelOutput: workingRepositoryModelOutput,
  });
} } });
