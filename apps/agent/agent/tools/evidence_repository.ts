import { defineTool } from "eve/tools";
import { z } from "zod";

import { EvidenceRepositoryService } from "../../repositories/evidence/service";

const actionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("catalog") }),
  z.object({
    action: z.literal("list_files"),
    repositoryId: z.string().min(1),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  z.object({
    action: z.literal("search"),
    repositoryId: z.string().min(1),
    query: z.string().min(1).max(500),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({
    action: z.literal("read"),
    repositoryId: z.string().min(1),
    path: z.string().min(1),
    startLine: z.number().int().positive().default(1),
    endLine: z.number().int().positive().optional(),
    maxCharacters: z.number().int().min(1).max(24_000).default(24_000),
  }),
]);

export const evidenceRepositoryToolInputSchema = z.object({
  action: z.enum(["catalog", "list_files", "search", "read"]),
  repositoryId: z.string().min(1).optional(),
  pathPrefix: z.string().optional(),
  limit: z.number().int().positive().optional(),
  query: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  maxCharacters: z.number().int().positive().optional(),
}).strict().pipe(actionInputSchema);

export default defineTool({
  description:
    "Inspect Paige's configured read-only evidence repositories without modifying them. Use catalog to discover evidence repository IDs, list_files to browse snapshot paths, search for literal text, and read for bounded line ranges. Results include the resolved Git revision.",
  inputSchema: evidenceRepositoryToolInputSchema,
  async execute(input, ctx) {
    const service = new EvidenceRepositoryService(ctx);

    switch (input.action) {
      case "catalog":
        return { action: input.action, repositories: service.catalog() };
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
    }
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
