import { randomUUID } from "node:crypto";

export function onboardingEvalIdentity(userId = "U_ONBOARDING"): {
  headers: Record<string, string>;
  workspaceId: string;
} {
  const token = process.env.PAIGE_EVAL_AUTH_TOKEN;
  if (!token) {
    throw new Error(
      "PAIGE_EVAL_AUTH_TOKEN is required for repository onboarding evals.",
    );
  }

  const workspaceId = `T_EVAL_${randomUUID()}`;
  return {
    workspaceId,
    headers: {
      "x-paige-eval-token": token,
      "x-paige-eval-user": userId,
      "x-paige-eval-workspace": workspaceId,
    },
  };
}

export function teammateHeaders(
  identity: ReturnType<typeof onboardingEvalIdentity>,
): Record<string, string> {
  return {
    ...identity.headers,
    "x-paige-eval-user": "U_TEAMMATE",
  };
}
