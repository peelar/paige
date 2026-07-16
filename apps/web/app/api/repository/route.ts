import { repositoryConfigurationStore } from "../../../../agent/repositories/configuration/database";
import {
  RepositoryConfigurationService,
  summarizeRepositoryConfiguration,
} from "../../../../agent/repositories/configuration/service";
import { RepositoryError } from "../../../../agent/repositories/shared/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const workspaceId = resolveOperatorWorkspace(request);
  if (workspaceId instanceof Response) return workspaceId;

  try {
    const active = await repositoryConfigurationStore().get(workspaceId).match(
      (value) => value,
      raiseRepositoryError,
    );

    return Response.json(
      active === undefined
        ? { configured: false }
        : {
          configured: true,
          repository: summarizeRepositoryConfiguration(active)
            .documentationRepository,
          updatedAt: active.updatedAt,
        },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const workspaceId = resolveOperatorWorkspace(request);
  if (workspaceId instanceof Response) return workspaceId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Expected a repository URL.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("repositoryUrl" in body) ||
    typeof body.repositoryUrl !== "string"
  ) {
    return errorResponse(400, "Expected a repository URL.");
  }

  try {
    const store = repositoryConfigurationStore();
    const service = new RepositoryConfigurationService(
      { abortSignal: request.signal },
      store,
    );
    const active = await service.get(workspaceId).match(
      (value) => value,
      raiseRepositoryError,
    );
    const evidenceRepositoryUrls = active?.evidenceRepositories.map(
      ({ owner, name }) => `https://github.com/${owner}/${name}`,
    ) ?? [];
    const configuration = await service.propose({
      documentationRepositoryUrl: body.repositoryUrl,
      evidenceRepositoryUrls,
    }).match((value) => value, raiseRepositoryError);
    const saved = await service.confirm({
      workspaceId,
      configuration,
      expectedRevision: active?.revision ?? null,
    }).match((value) => value, raiseRepositoryError);

    return Response.json(
      {
        configured: true,
        repository: summarizeRepositoryConfiguration(saved)
          .documentationRepository,
        updatedAt: saved.updatedAt,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

const noStoreHeaders = { "cache-control": "no-store" };

function resolveOperatorWorkspace(request: Request): string | Response {
  if (process.env.PAIGE_OPERATOR_ACCESS !== "local") {
    return errorResponse(
      403,
      "Repository management is available only in the local operator app.",
    );
  }

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1"
  ) {
    return errorResponse(403, "Repository management requires localhost.");
  }

  const workspaceId = process.env.PAIGE_OPERATOR_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    return errorResponse(
      503,
      "Set PAIGE_OPERATOR_WORKSPACE_ID to the Slack workspace Paige should manage.",
    );
  }

  return workspaceId;
}

function repositoryErrorResponse(error: unknown): Response {
  if (error instanceof RepositoryError) {
    const status = error.code === "REPOSITORY_INVALID_INPUT" ? 400 :
      error.code === "REPOSITORY_CONFLICT" ? 409 : 503;
    return errorResponse(status, error.message);
  }

  return errorResponse(503, "Repository setup is temporarily unavailable.");
}

function errorResponse(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: noStoreHeaders },
  );
}

function raiseRepositoryError(error: Error): never {
  throw error;
}
