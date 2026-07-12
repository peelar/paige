import {
  mutateOperatorMemory,
  operatorMemoryMutationInputSchema,
  OperatorMemoryTransitionError,
} from "@docs-agent/control-plane";

import { resolveOperatorAccess } from "@/lib/operator";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const access = await resolveOperatorAccess(request.headers);
  if (access.status !== "authorized") return accessError(access.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response(400, "invalid_memory_transition", "Expected a JSON lifecycle payload.");
  }

  const parsedBody = operatorMemoryMutationInputSchema
    .omit({ id: true, actor: true })
    .safeParse(body);
  if (!parsedBody.success) {
    return response(
      400,
      "invalid_memory_transition",
      "Choose a supported lifecycle action and provide a reason.",
    );
  }

  const { id } = await context.params;
  try {
    const memory = await mutateOperatorMemory({
      id,
      action: parsedBody.data.action,
      reason: parsedBody.data.reason,
      actor: access.principal.id,
    });
    return Response.json(
      { memory },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof OperatorMemoryTransitionError) {
      return response(409, "memory_transition_rejected", error.message);
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return response(404, "memory_not_found", "Workspace memory not found.");
    }
    return response(
      503,
      "memory_transition_unavailable",
      "The memory lifecycle change could not be persisted. Check database readiness and retry.",
    );
  }
}

function response(status: number, code: string, error: string): Response {
  return Response.json(
    { code, error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function accessError(status: "unauthorized" | "forbidden" | "unavailable"): Response {
  const httpStatus = status === "unauthorized" ? 401 : status === "forbidden" ? 403 : 503;
  return response(httpStatus, `operator_${status}`, `Operator access is ${status}.`);
}
