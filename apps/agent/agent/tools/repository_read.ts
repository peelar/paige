import { defineTool } from "eve/tools";
import { z } from "zod";

import { RepositoryService } from "../../repositories/service";

const refSchema = z.string().min(1).max(200);

const actionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("catalog") }),
  z.object({
    action: z.literal("list_files"),
    repositoryId: z.string().min(1),
    ref: refSchema.optional(),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  z.object({
    action: z.literal("search"),
    repositoryId: z.string().min(1),
    ref: refSchema.optional(),
    query: z.string().min(1).max(500),
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({
    action: z.literal("read"),
    repositoryId: z.string().min(1),
    ref: refSchema.optional(),
    path: z.string().min(1),
    startLine: z.number().int().positive().default(1),
    endLine: z.number().int().positive().optional(),
    maxCharacters: z.number().int().min(1).max(24_000).default(24_000),
  }),
  z.object({
    action: z.literal("compare"),
    repositoryId: z.string().min(1),
    baseRef: refSchema,
    headRef: refSchema,
    pathPrefix: z.string().default("."),
    limit: z.number().int().min(1).max(200).default(100),
  }),
]);

export const repositoryReadToolInputSchema = z.object({
  action: z.enum(["catalog", "list_files", "search", "read", "compare"]),
  repositoryId: z.string().min(1).optional(),
  ref: refSchema.optional(),
  baseRef: refSchema.optional(),
  headRef: refSchema.optional(),
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
    "Read Paige's configured Git repositories without publishing changes. Use catalog to discover repository IDs and roles, list_files/search/read for files at an exact ref, and compare for bounded changed-path lists between two branches, tags, or commit SHAs.",
  inputSchema: repositoryReadToolInputSchema,
  async execute(input, ctx) {
    const service = new RepositoryService(ctx);

    switch (input.action) {
      case "catalog":
        return await service.catalog().match(
          (repositories) => ({ action: input.action, repositories }),
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
      case "compare":
        return await service.compare(input).match(
          (output) => ({ action: input.action, ...output }),
          raiseRepositoryError,
        );
    }
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
