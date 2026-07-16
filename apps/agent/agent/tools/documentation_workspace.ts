import { defineTool } from "eve/tools";
import { z } from "zod";

import { DocumentationRepositoryService } from "../../repositories/documentation/service";

const actionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({
    action: z.literal("list_files"),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1).max(500),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({
    action: z.literal("read"),
    path: z.string().min(1),
    startLine: z.number().int().positive().default(1),
    endLine: z.number().int().positive().optional(),
    maxCharacters: z.number().int().min(1).max(24_000).default(24_000),
  }),
  z.object({
    action: z.literal("write"),
    path: z.string().min(1),
    content: z.string().max(200_000),
  }),
  z.object({
    action: z.literal("remove"),
    path: z.string().min(1),
  }),
  z.object({ action: z.literal("inspect_diff") }),
]);

export const documentationWorkspaceToolInputSchema = z.object({
  action: z.enum([
    "prepare",
    "list_files",
    "search",
    "read",
    "write",
    "remove",
    "inspect_diff",
  ]),
  pathPrefix: z.string().optional(),
  limit: z.number().int().positive().optional(),
  query: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  content: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  maxCharacters: z.number().int().positive().optional(),
}).strict().pipe(actionInputSchema);

export default defineTool({
  description:
    "Draft changes in Paige's configured documentation repository without publishing. Use prepare first, then bounded list/search/read/write/remove actions, and inspect_diff to present the complete reviewable patch and approval digest. For read-only documentation work, repository_read is also available.",
  inputSchema: documentationWorkspaceToolInputSchema,
  async execute(input, ctx) {
    const service = new DocumentationRepositoryService(ctx);

    switch (input.action) {
      case "prepare":
        return await service.prepareWorkspace().match(
          (workspace) => ({ action: input.action, workspace }),
          raiseRepositoryError,
        );
      case "list_files":
        return await service.listFiles(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "search":
        return await service.search(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "read":
        return await service.read(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "write":
        return await service.write(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "remove":
        return await service.remove(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
      case "inspect_diff":
        return await service.inspectDiff().match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
    }
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
