import { resolveRepositoryConfigurationStore } from "../../../../agent/repositories/configuration/database";
import {
  RepositoryConfigurationService,
  summarizeRepositoryConfiguration,
} from "../../../../agent/repositories/configuration/service";
import type { RepositoryError } from "../../../../agent/repositories/shared/errors";
import {
  isOperatorAccessFailure,
  localOperatorAccess,
} from "@/operator-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return errorResponse(access.status, access.error);
  }

  const result = await resolveRepositoryConfigurationStore()
    .asyncAndThen((store) => store.get());
  if (result.isErr()) return repositoryErrorResponse(result.error);

  return Response.json(
    result.value === undefined
      ? { configured: false }
      : {
        configured: true,
        repository: summarizeRepositoryConfiguration(result.value)
          .documentationRepository,
        updatedAt: result.value.updatedAt,
      },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request): Promise<Response> {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return errorResponse(access.status, access.error);
  }

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
  const repositoryUrl = body.repositoryUrl;

  const result = await resolveRepositoryConfigurationStore()
    .asyncAndThen((store) => {
      const service = new RepositoryConfigurationService(
        { abortSignal: request.signal },
        store,
      );
      return service.get().andThen((active) => {
        const evidenceRepositoryUrls = active?.evidenceRepositories.map(
          ({ owner, name }) => `https://github.com/${owner}/${name}`,
        ) ?? [];
        return service.propose({
          documentationRepositoryUrl: repositoryUrl,
          evidenceRepositoryUrls,
        }).andThen((configuration) =>
          service.confirm({
            configuration,
            expectedRevision: active?.revision ?? null,
          })
        );
      });
    });
  if (result.isErr()) return repositoryErrorResponse(result.error);

  return Response.json(
    {
      configured: true,
      repository: summarizeRepositoryConfiguration(result.value)
        .documentationRepository,
      updatedAt: result.value.updatedAt,
    },
    { headers: noStoreHeaders },
  );
}

const noStoreHeaders = { "cache-control": "no-store" };

function repositoryErrorResponse(error: RepositoryError): Response {
  const status = error.code === "REPOSITORY_INVALID_INPUT" ? 400 :
    error.code === "REPOSITORY_CONFLICT" ? 409 : 503;
  return errorResponse(status, error.message);
}

function errorResponse(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: noStoreHeaders },
  );
}
