import {
  type AuthFn,
  UnauthenticatedError,
} from "eve/channels/auth";

const operatorHeader = "x-paige-operator";

export function operatorWebAuth(): AuthFn<Request> {
  return (request) => {
    if (request.headers.get(operatorHeader) !== "local") return null;

    if (
      process.env.PAIGE_OPERATOR_ACCESS !== "local" ||
      !isLocalHostname(new URL(request.url).hostname)
    ) {
      throw new UnauthenticatedError({
        message: "Invalid Paige operator authentication.",
      });
    }

    return {
      authenticator: "paige-operator",
      principalType: "user",
      principalId: "operator:local",
      attributes: {},
    };
  };
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1";
}
