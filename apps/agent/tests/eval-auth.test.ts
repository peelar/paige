import { afterEach, describe, expect, it } from "vitest";

import { evalSlackAuth } from "../repositories/configuration/eval-auth";

const originalToken = process.env.PAIGE_EVAL_AUTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.PAIGE_EVAL_AUTH_TOKEN;
  } else {
    process.env.PAIGE_EVAL_AUTH_TOKEN = originalToken;
  }
});

describe("evalSlackAuth", () => {
  it("ignores ordinary requests", () => {
    process.env.PAIGE_EVAL_AUTH_TOKEN = "secret";

    expect(
      evalSlackAuth()(new Request("http://localhost")),
    ).toBeNull();
  });

  it("returns workspace-scoped Slack identity for valid eval headers", () => {
    process.env.PAIGE_EVAL_AUTH_TOKEN = "secret";

    expect(
      evalSlackAuth()(evalRequest("secret")),
    ).toEqual({
      authenticator: "slack",
      principalType: "user",
      principalId: "U_EVAL",
      attributes: { slackWorkspaceId: "T_EVAL" },
    });
  });

  it("rejects incomplete or invalid eval credentials", () => {
    process.env.PAIGE_EVAL_AUTH_TOKEN = "secret";

    expect(() => evalSlackAuth()(evalRequest("wrong"))).toThrow(
      "Invalid Paige eval authentication.",
    );
  });
});

function evalRequest(token: string): Request {
  return new Request("http://localhost", {
    headers: {
      "x-paige-eval-token": token,
      "x-paige-eval-user": "U_EVAL",
      "x-paige-eval-workspace": "T_EVAL",
    },
  });
}
