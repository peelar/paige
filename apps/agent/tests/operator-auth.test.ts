import { afterEach, describe, expect, it } from "vitest";

import { operatorWebAuth } from "../repositories/configuration/operator-auth";

const originalAccess = process.env.PAIGE_OPERATOR_ACCESS;

afterEach(() => {
  restoreEnvironment("PAIGE_OPERATOR_ACCESS", originalAccess);
});

describe("operatorWebAuth", () => {
  it("ignores requests without the local operator header", () => {
    expect(
      operatorWebAuth()(new Request("http://agent.paige.localhost")),
    ).toBeNull();
  });

  it("returns a channel-neutral identity for local operator requests", () => {
    process.env.PAIGE_OPERATOR_ACCESS = "local";

    expect(operatorWebAuth()(operatorRequest())).toEqual({
      authenticator: "paige-operator",
      principalType: "user",
      principalId: "operator:local",
      attributes: {},
    });
  });

  it("rejects disabled or non-local operator requests", () => {
    process.env.PAIGE_OPERATOR_ACCESS = "local";
    expect(() =>
      operatorWebAuth()(operatorRequest("https://agent.example.com"))
    ).toThrow("Invalid Paige operator authentication.");

    delete process.env.PAIGE_OPERATOR_ACCESS;
    expect(() => operatorWebAuth()(operatorRequest())).toThrow(
      "Invalid Paige operator authentication.",
    );
  });
});

function operatorRequest(
  url = "http://agent.paige.localhost",
): Request {
  return new Request(url, {
    headers: { "x-paige-operator": "local" },
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
