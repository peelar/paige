import { parseArgs } from "node:util";

import { z } from "zod";

import {
  workspaceOnboardingInputSchema,
  type WorkspaceOnboardingInput,
} from "./workspace-onboarding.ts";

const operatorLoginSchema = z.string().trim().min(1);

export type SetupCommand =
  | { kind: "help" }
  | { kind: "status" }
  | {
      kind: "configure";
      input: WorkspaceOnboardingInput;
      operatorLogin: string;
    };

export const setupCommandUsage = `Usage:
  pnpm paige status
  pnpm paige configure --repository-url <url> --github-connector <uid> --operator-login <login> [options]

Options:
  --ref <ref>                    Working repository ref (default: main)
  --docs-root <path>             Docs root; omit to infer it after checkout
  --watched-repository <url>     Read-only evidence repository; repeat as needed
  --context-repository <url>     Read-only workspace context; repeat as needed
  -h, --help                     Show this help`;

export function parseSetupCommand(args: string[]): SetupCommand {
  const [command, ...commandArgs] = args;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { kind: "help" };
  }
  if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
    return { kind: "help" };
  }

  if (command === "status") {
    parseArgs({ args: commandArgs, allowPositionals: false, strict: true });
    return { kind: "status" };
  }

  if (command !== "configure") {
    throw new Error(`Unknown setup command: ${command}`);
  }

  const { values } = parseArgs({
    args: commandArgs,
    allowPositionals: false,
    strict: true,
    options: {
      "repository-url": { type: "string" },
      "github-connector": { type: "string" },
      "operator-login": { type: "string" },
      ref: { type: "string" },
      "docs-root": { type: "string" },
      "watched-repository": { type: "string", multiple: true },
      "context-repository": { type: "string", multiple: true },
    },
  });

  const repositoryUrl = requiredOption(values["repository-url"], "--repository-url");
  const githubConnector = requiredOption(
    values["github-connector"],
    "--github-connector",
  );
  const operatorLogin = operatorLoginSchema.parse(
    requiredOption(values["operator-login"], "--operator-login"),
  );

  return {
    kind: "configure",
    operatorLogin,
    input: workspaceOnboardingInputSchema.parse({
      repositoryUrl,
      ref: values.ref,
      docsRoot: values["docs-root"],
      githubConnector,
      watchedRepositories: (values["watched-repository"] ?? []).map(
        (watchedRepositoryUrl) => ({ repositoryUrl: watchedRepositoryUrl }),
      ),
      contextRepositories: (values["context-repository"] ?? []).map(
        (contextRepositoryUrl) => ({ repositoryUrl: contextRepositoryUrl }),
      ),
    }),
  };
}

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}
