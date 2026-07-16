import { timingSafeEqual } from "node:crypto";

import {
  type AuthFn,
  UnauthenticatedError,
} from "eve/channels/auth";

const workspaceHeader = "x-paige-eval-workspace";
const userHeader = "x-paige-eval-user";
const tokenHeader = "x-paige-eval-token";

export function evalSlackAuth(): AuthFn<Request> {
  return (request) => {
    const workspaceId = request.headers.get(workspaceHeader)?.trim();
    const userId = request.headers.get(userHeader)?.trim();
    const suppliedToken = request.headers.get(tokenHeader);

    if (!workspaceId && !userId && !suppliedToken) return null;

    const expectedToken = process.env.PAIGE_EVAL_AUTH_TOKEN;
    if (
      !workspaceId ||
      !userId ||
      !suppliedToken ||
      !expectedToken ||
      !tokensMatch(suppliedToken, expectedToken)
    ) {
      throw new UnauthenticatedError({
        message: "Invalid Paige eval authentication.",
      });
    }

    return {
      authenticator: "slack",
      principalType: "user",
      principalId: userId,
      attributes: { slackWorkspaceId: workspaceId },
    };
  };
}

function tokensMatch(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes);
}
