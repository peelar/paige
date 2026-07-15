import {
  archiveInternalDocument,
  archiveInternalDocumentInputSchema,
  attachInternalDocument,
  attachInternalDocumentInputSchema,
  createInternalDocument,
  createInternalDocumentInputSchema,
  findInternalDocumentByAttachment,
  findInternalDocumentByAttachmentInputSchema,
  internalDocumentMutationResultSchema,
  internalDocumentSchema,
  internalDocumentSourceReferencesSchema,
  readInternalDocument,
  readInternalDocumentInputSchema,
  resolveWatchContinuityContext,
  updateInternalDocument,
  updateInternalDocumentInputSchema,
  watchContinuityAttachment,
  watchContinuitySourceReferences,
  type WatchContinuityContext,
} from "@docs-agent/control-plane/agent";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  requireCapabilityToolExecution,
  resolveDynamicCapabilities,
  watchDispatchClaimFromAuth,
} from "../lib/capability-resolution";
import { PAIGE_WATCH_CAPABILITY_REGISTRY } from "../lib/slack-watch-admission";

const createInputSchema = createInternalDocumentInputSchema.extend({ mode: z.literal("create") });
const readInputSchema = readInternalDocumentInputSchema.extend({ mode: z.literal("read") });
const updateInputSchema = updateInternalDocumentInputSchema.extend({ mode: z.literal("update") });
const findInputSchema = findInternalDocumentByAttachmentInputSchema.extend({ mode: z.literal("find") });
const attachInputSchema = attachInternalDocumentInputSchema.extend({ mode: z.literal("attach") });
const archiveInputSchema = archiveInternalDocumentInputSchema.extend({ mode: z.literal("archive") });

const internalDocumentModeInputSchema = z.discriminatedUnion("mode", [
  createInputSchema,
  readInputSchema,
  updateInputSchema,
  findInputSchema,
  attachInputSchema,
  archiveInputSchema,
]);

export const internalDocumentInputSchema = z.object({
  mode: z.enum(["create", "read", "update", "find", "attach", "archive"]),
  title: createInternalDocumentInputSchema.shape.title.optional(),
  kind: createInternalDocumentInputSchema.shape.kind.removeDefault().optional(),
  editingProfile: createInternalDocumentInputSchema.shape.editingProfile.removeDefault().optional(),
  content: createInternalDocumentInputSchema.shape.content.optional(),
  retentionDays: createInternalDocumentInputSchema.shape.retentionDays.removeDefault().optional(),
  attachment: createInternalDocumentInputSchema.shape.attachment.optional(),
  sourceReferences: createInternalDocumentInputSchema.shape.sourceReferences.removeDefault().optional(),
  documentId: readInternalDocumentInputSchema.shape.documentId.optional(),
  revision: readInternalDocumentInputSchema.shape.revision.optional(),
  expectedRevision: updateInternalDocumentInputSchema.shape.expectedRevision.optional(),
  changeSummary: updateInternalDocumentInputSchema.shape.changeSummary.optional(),
  reason: archiveInternalDocumentInputSchema.shape.reason.optional(),
}).strict().pipe(internalDocumentModeInputSchema);

const outputSchema = z.union([
  internalDocumentMutationResultSchema.extend({
    mode: z.enum(["create", "update", "attach", "archive"]),
  }),
  z.object({ mode: z.literal("read"), document: internalDocumentSchema }).strict(),
  z.object({
    mode: z.literal("find"),
    document: internalDocumentSchema.nullable(),
  }).strict(),
]);

type InternalDocumentToolInput = z.infer<typeof internalDocumentInputSchema>;
type InternalDocumentSourceReferences = z.infer<
  typeof internalDocumentSourceReferencesSchema
>;
type ResolvedWatchContinuity = WatchContinuityContext & {
  document: NonNullable<WatchContinuityContext["document"]>;
};

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("internal_document")) return null;
  return defineTool({
  description:
    "Create, read, update, find, attach, or archive a bounded internal Paige working document. Use this for explicit, inspectable documentation-work state that must survive Eve sessions; it is not workspace memory, hidden reasoning, or a public documentation draft. To revise an existing document, read it and then update that same documentId with its currentRevision; never create a second document for the same working purpose. Document kind and editing profile guide the applicable skill but do not add authority.",
  inputSchema: internalDocumentInputSchema,
  outputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("internal_document", ctx);
    const watchClaim = watchDispatchClaimFromAuth(ctx.session.auth);
    const continuity = watchClaim === null
      ? null
      : await resolveWatchContinuityContext(watchClaim.reservationId, {
          capabilityRegistry: PAIGE_WATCH_CAPABILITY_REGISTRY,
        }, {
          sessionId: ctx.session.id,
          runId: ctx.session.turn.id,
        }, { claimToken: watchClaim.claimToken });
    if (continuity !== null && continuity.document === null) {
      throw new Error("The current watch has no docs_work.manage continuity authority.");
    }
    const scopedInput = continuity?.document === null || continuity === null
      ? input
      : scopeWatchInternalDocumentInput(input, continuity as ResolvedWatchContinuity);
    const commandContext = {
      authority: "docs_work.manage" as const,
      actor: { type: "agent" as const, id: "paige-agent" },
      sessionId: ctx.session.id,
      runId: ctx.session.turn.id,
      operationKey: ctx.callId,
    };

    switch (scopedInput.mode) {
      case "create":
        return {
          mode: "create" as const,
          ...(await createInternalDocument({
            title: scopedInput.title,
            kind: scopedInput.kind,
            editingProfile: scopedInput.editingProfile,
            content: scopedInput.content,
            retentionDays: scopedInput.retentionDays,
            attachment: scopedInput.attachment,
            sourceReferences: scopedInput.sourceReferences,
          }, commandContext)),
        };
      case "read":
        return {
          mode: "read" as const,
          document: await readInternalDocument({
            documentId: scopedInput.documentId,
            revision: scopedInput.revision,
          }, commandContext),
        };
      case "update":
        return {
          mode: "update" as const,
          ...(await updateInternalDocument({
            documentId: scopedInput.documentId,
            expectedRevision: scopedInput.expectedRevision,
            content: scopedInput.content,
            changeSummary: scopedInput.changeSummary,
            sourceReferences: scopedInput.sourceReferences,
          }, commandContext)),
        };
      case "find":
        return {
          mode: "find" as const,
          document: await findInternalDocumentByAttachment({
            attachment: scopedInput.attachment,
          }, commandContext),
        };
      case "attach":
        return {
          mode: "attach" as const,
          ...(await attachInternalDocument({
            documentId: scopedInput.documentId,
            expectedRevision: scopedInput.expectedRevision,
            attachment: scopedInput.attachment,
          }, commandContext)),
        };
      case "archive":
        return {
          mode: "archive" as const,
          ...(await archiveInternalDocument({
            documentId: scopedInput.documentId,
            expectedRevision: scopedInput.expectedRevision,
            reason: scopedInput.reason,
            sourceReferences: scopedInput.sourceReferences,
          }, commandContext)),
        };
    }
  },
  toModelOutput(output) {
    return { type: "json", value: output };
  },
  });
} } });

export function scopeWatchInternalDocumentInput(
  input: InternalDocumentToolInput,
  continuity: ResolvedWatchContinuity,
): InternalDocumentToolInput {
  const attachment = watchContinuityAttachment(continuity.runtime.watchId);
  const sourceReferences = (references: InternalDocumentSourceReferences) => mergeWatchSourceReferences(
      watchContinuitySourceReferences(continuity.runtime),
      references,
    );

  switch (input.mode) {
    case "create":
      return { ...input, attachment, sourceReferences: sourceReferences(input.sourceReferences) };
    case "find":
      return { ...input, attachment };
    case "read":
      requireContinuityDocument(input.documentId, continuity.document.id);
      return input;
    case "update":
      requireContinuityDocument(input.documentId, continuity.document.id);
      return { ...input, sourceReferences: sourceReferences(input.sourceReferences) };
    case "attach":
      requireContinuityDocument(input.documentId, continuity.document.id);
      return { ...input, attachment };
    case "archive":
      throw new Error("An active watch occurrence cannot archive its continuity document.");
  }
}

function mergeWatchSourceReferences(
  required: InternalDocumentSourceReferences,
  supplied: InternalDocumentSourceReferences,
): InternalDocumentSourceReferences {
  const seen = new Set<string>();
  return internalDocumentSourceReferencesSchema.parse(
    [...required, ...supplied].filter((reference) => {
      const key = JSON.stringify([reference.kind, reference.id, reference.url ?? null]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20),
  );
}

function requireContinuityDocument(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error("A watch occurrence may access only its attached continuity document.");
  }
}
