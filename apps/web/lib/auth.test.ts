import "server-only";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";
import { testUtils } from "better-auth/plugins";

import { buildGitHubAuthOptions } from "./auth";
import { parseApprovedGitHubLogins } from "./auth-config";

export const testAuthDatabase: Record<string, Array<Record<string, unknown>>> = {
  account: [],
  session: [],
  user: [],
  verification: [],
};

const testBaseURL = process.env.DOCS_AGENT_TEST_BASE_URL;
if (!testBaseURL) {
  throw new Error("DOCS_AGENT_TEST_BASE_URL is required in operator auth test mode.");
}

const testAuthOptions = buildGitHubAuthOptions({
  secret: "test-only-better-auth-secret-32-characters",
  baseURL: testBaseURL,
  clientId: "test-github-client-id",
  clientSecret: "test-github-client-secret",
  approvedLogins: parseApprovedGitHubLogins("testoperator"),
}, {
  secureCookies: false,
  database: memoryAdapter(testAuthDatabase),
});

export const testOperatorAuth = betterAuth({
  ...testAuthOptions,
  plugins: [testUtils(), nextCookies()],
  rateLimit: { enabled: false },
});

export async function createTestOperatorSession(input: {
  githubId: string;
  githubLogin: string;
  displayName: string;
  expired?: boolean;
}): Promise<Headers> {
  const context = await testOperatorAuth.$context;
  const existing = await context.internalAdapter.findUserById(input.githubId);
  if (!existing) {
    await context.test.saveUser(context.test.createUser({
      id: input.githubId,
      email: `${input.githubLogin}@example.test`,
      name: input.displayName,
      githubLogin: input.githubLogin,
    }));
  }
  const login = await context.test.login({ userId: input.githubId });
  if (input.expired) expireTestSession(login.token);
  const headers = new Headers();
  for (const cookie of login.cookies) {
    const attributes = [
      `${cookie.name}=${cookie.value}`,
      `Path=${cookie.path}`,
      cookie.httpOnly ? "HttpOnly" : null,
      cookie.secure ? "Secure" : null,
      cookie.sameSite ? `SameSite=${cookie.sameSite}` : null,
      cookie.expires
        ? `Expires=${new Date(cookie.expires * 1_000).toUTCString()}`
        : null,
    ].filter((attribute): attribute is string => attribute !== null);
    headers.append("set-cookie", attributes.join("; "));
  }
  const cacheResponse = await testOperatorAuth.handler(new Request(
    `${testBaseURL}/api/auth/get-session`,
    { headers: login.headers },
  ));
  for (const cookie of cacheResponse.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}

function expireTestSession(token: string): void {
  for (const rows of Object.values(testAuthDatabase)) {
    const session = rows.find((row) => row.token === token);
    if (session) session.expiresAt = new Date(0);
  }
}
