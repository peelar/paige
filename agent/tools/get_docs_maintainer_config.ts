import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  DOCS_MAINTAINER_CONFIG_PATH,
  docsMaintainerConfigSchema,
  readDocsMaintainerConfig,
} from "../lib/docs-maintainer-config.js";

const outputSchema = z.object({
  configPath: z.string(),
  config: docsMaintainerConfigSchema,
});

export default defineTool({
  description:
    "Return the app-local docs maintainer config, including the configured working repository when one has been set.",
  inputSchema: z.object({}),
  outputSchema,
  async execute() {
    return {
      configPath: DOCS_MAINTAINER_CONFIG_PATH,
      config: await readDocsMaintainerConfig(),
    };
  },
  toModelOutput(output) {
    const repository = output.config.workingRepositoryInput?.workingDocumentationRepository;

    return {
      type: "json",
      value: {
        configPath: output.configPath,
        hasWorkingRepository: repository !== undefined,
        workingRepository: repository === undefined
          ? null
          : {
              url: repository.source.url,
              ref: repository.ref,
              docsRoot: repository.docsRoot,
              sandboxPath: repository.sandboxPath,
            },
      },
    };
  },
});
