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
  readInternalDocument,
  readInternalDocumentInputSchema,
  updateInternalDocument,
  updateInternalDocumentInputSchema,
} from "@docs-agent/control-plane/agent";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { requireCapabilityToolExecution, resolveDynamicCapabilities } from "../lib/capability-resolution";

const inputSchema = z.discriminatedUnion("mode", [
  createInternalDocumentInputSchema.extend({ mode: z.literal("create") }),
  readInternalDocumentInputSchema.extend({ mode: z.literal("read") }),
  updateInternalDocumentInputSchema.extend({ mode: z.literal("update") }),
  findInternalDocumentByAttachmentInputSchema.extend({ mode: z.literal("find") }),
  attachInternalDocumentInputSchema.extend({ mode: z.literal("attach") }),
  archiveInternalDocumentInputSchema.extend({ mode: z.literal("archive") }),
]);

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

export default defineDynamic({ events: { "step.started": async (event, context) => {
  if (!(await resolveDynamicCapabilities(event, context)).toolNames.includes("internal_document")) return null;
  return defineTool({
  description:
    "Create, read, update, find, attach, or archive a bounded internal Paige working document. Use this for explicit, inspectable documentation-work state that must survive Eve sessions; it is not workspace memory, hidden reasoning, or a public documentation draft. To revise an existing document, read it and then update that same documentId with its currentRevision; never create a second document for the same working purpose. Document kind and editing profile guide the applicable skill but do not add authority.",
  inputSchema,
  outputSchema,
  async execute(input, ctx) {
    await requireCapabilityToolExecution("internal_document", ctx);
    const commandContext = {
      authority: "docs_work.manage" as const,
      actor: { type: "agent" as const, id: "paige-agent" },
      sessionId: ctx.session.id,
      runId: ctx.session.turn.id,
      operationKey: ctx.callId,
    };

    switch (input.mode) {
      case "create":
        return {
          mode: "create" as const,
          ...(await createInternalDocument({
            title: input.title,
            kind: input.kind,
            editingProfile: input.editingProfile,
            content: input.content,
            retentionDays: input.retentionDays,
            attachment: input.attachment,
            sourceReferences: input.sourceReferences,
          }, commandContext)),
        };
      case "read":
        return {
          mode: "read" as const,
          document: await readInternalDocument({
            documentId: input.documentId,
            revision: input.revision,
          }, commandContext),
        };
      case "update":
        return {
          mode: "update" as const,
          ...(await updateInternalDocument({
            documentId: input.documentId,
            expectedRevision: input.expectedRevision,
            content: input.content,
            changeSummary: input.changeSummary,
            sourceReferences: input.sourceReferences,
          }, commandContext)),
        };
      case "find":
        return {
          mode: "find" as const,
          document: await findInternalDocumentByAttachment({
            attachment: input.attachment,
          }, commandContext),
        };
      case "attach":
        return {
          mode: "attach" as const,
          ...(await attachInternalDocument({
            documentId: input.documentId,
            expectedRevision: input.expectedRevision,
            attachment: input.attachment,
          }, commandContext)),
        };
      case "archive":
        return {
          mode: "archive" as const,
          ...(await archiveInternalDocument({
            documentId: input.documentId,
            expectedRevision: input.expectedRevision,
            reason: input.reason,
            sourceReferences: input.sourceReferences,
          }, commandContext)),
        };
    }
  },
  toModelOutput(output) {
    return { type: "json", value: output };
  },
  });
} } });
