import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  repositoryInputSchema,
  type RepositoryInput,
} from "./repository-contract.js";

export const DOCS_MAINTAINER_CONFIG_PATH = ".docs-maintainer/config.json";

export const docsMaintainerConfigSchema = z.object({
  version: z.literal(1).default(1),
  workingRepositoryInput: repositoryInputSchema.optional(),
});

export type DocsMaintainerConfig = z.infer<typeof docsMaintainerConfigSchema>;

export async function readDocsMaintainerConfig(): Promise<DocsMaintainerConfig> {
  try {
    const content = await readFile(DOCS_MAINTAINER_CONFIG_PATH, "utf8");
    return docsMaintainerConfigSchema.parse(JSON.parse(content));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return docsMaintainerConfigSchema.parse({});
    }

    throw error;
  }
}

export async function readConfiguredRepositoryInput(): Promise<RepositoryInput | null> {
  const config = await readDocsMaintainerConfig();
  return config.workingRepositoryInput ?? null;
}

export async function writeConfiguredRepositoryInput(
  input: RepositoryInput,
): Promise<RepositoryInput> {
  const repositoryInput = repositoryInputSchema.parse(input);
  const currentConfig = await readDocsMaintainerConfig();
  const nextConfig = docsMaintainerConfigSchema.parse({
    ...currentConfig,
    version: 1,
    workingRepositoryInput: repositoryInput,
  });

  await mkdir(dirname(DOCS_MAINTAINER_CONFIG_PATH), { recursive: true });
  await writeFile(
    DOCS_MAINTAINER_CONFIG_PATH,
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    "utf8",
  );

  return repositoryInput;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
