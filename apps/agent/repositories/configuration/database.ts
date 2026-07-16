import { createClient } from "@libsql/client";

import { RepositoryError } from "../shared/errors";
import {
  LibsqlRepositoryConfigurationStore,
} from "./store";

let store: LibsqlRepositoryConfigurationStore | undefined;

export function repositoryConfigurationStore():
  LibsqlRepositoryConfigurationStore {
  if (store !== undefined) return store;

  const url = process.env.PAIGE_DATABASE_URL?.trim();
  if (!url) {
    throw new RepositoryError(
      "REPOSITORY_CONFIGURATION_FAILED",
      "Repository setup storage is not configured.",
    );
  }

  store = new LibsqlRepositoryConfigurationStore(createClient({
    url,
    authToken: process.env.PAIGE_DATABASE_AUTH_TOKEN?.trim() || undefined,
  }));
  return store;
}
