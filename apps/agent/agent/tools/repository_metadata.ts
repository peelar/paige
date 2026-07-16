import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  GitHubRepositoryMetadataService,
  MAX_REPOSITORY_METADATA_LIMIT,
} from "../../repositories/metadata/service";

const queryShape = {
  repositoryId: z.string().min(1),
  limit: z.number().int()
    .min(1)
    .max(MAX_REPOSITORY_METADATA_LIMIT)
    .default(20),
};

const actionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_releases"), ...queryShape }),
  z.object({ action: z.literal("list_open_issues"), ...queryShape }),
  z.object({ action: z.literal("list_open_pull_requests"), ...queryShape }),
  z.object({ action: z.literal("list_tags"), ...queryShape }),
  z.object({ action: z.literal("list_commits"), ...queryShape }),
]);

export const repositoryMetadataToolInputSchema = z.object({
  action: z.enum([
    "list_releases",
    "list_open_issues",
    "list_open_pull_requests",
    "list_tags",
    "list_commits",
  ]),
  repositoryId: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
}).strict().pipe(actionInputSchema);

export default defineTool({
  description:
    "List bounded GitHub metadata for Paige's configured repositories. Use repository_read catalog to discover repository IDs, then list releases, open issues, open pull requests, tags, or recent commits. Results preserve GitHub source URLs and timestamps. This read-only tool calls GitHub from the trusted app runtime and never runs sandbox shell commands.",
  inputSchema: repositoryMetadataToolInputSchema,
  async execute(input, ctx) {
    const service = new GitHubRepositoryMetadataService(ctx);
    const query = {
      repositoryId: input.repositoryId,
      limit: input.limit,
    };

    switch (input.action) {
      case "list_releases":
        return await service.listReleases(query).match(
          (releases) => ({
            action: input.action,
            repositoryId: input.repositoryId,
            releases,
          }),
          raiseRepositoryError,
        );
      case "list_open_issues":
        return await service.listOpenIssues(query).match(
          (issues) => ({
            action: input.action,
            repositoryId: input.repositoryId,
            issues,
          }),
          raiseRepositoryError,
        );
      case "list_open_pull_requests":
        return await service.listOpenPullRequests(query).match(
          (pullRequests) => ({
            action: input.action,
            repositoryId: input.repositoryId,
            pullRequests,
          }),
          raiseRepositoryError,
        );
      case "list_tags":
        return await service.listTags(query).match(
          (tags) => ({
            action: input.action,
            repositoryId: input.repositoryId,
            tags,
          }),
          raiseRepositoryError,
        );
      case "list_commits":
        return await service.listCommits(query).match(
          (commits) => ({
            action: input.action,
            repositoryId: input.repositoryId,
            commits,
          }),
          raiseRepositoryError,
        );
    }
  },
});

function raiseRepositoryError(error: Error): never {
  throw error;
}
