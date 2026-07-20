import { createClient } from "@libsql/client";
import { err, ok, Result } from "neverthrow";

import type { RepositoryResult } from "../shared/errors";
import { RepositoryError } from "../shared/errors";
import {
  LibsqlRepositoryConfigurationStore,
} from "./store";

let store: LibsqlRepositoryConfigurationStore | undefined;

export function resolveRepositoryConfigurationStore(): RepositoryResult<
  LibsqlRepositoryConfigurationStore
> {
  if (store !== undefined) return ok(store);

  const url = process.env.PAIGE_DATABASE_URL?.trim();
  if (!url) {
    return err(new RepositoryError(
      "REPOSITORY_CONFIGURATION_FAILED",
      "Repository setup storage is not configured.",
    ));
  }

  return Result.fromThrowable(
    () => {
      store = new LibsqlRepositoryConfigurationStore(createClient({
        url,
        authToken: process.env.PAIGE_DATABASE_AUTH_TOKEN?.trim() || undefined,
      }));
      return store;
    },
    (cause) =>
      new RepositoryError(
        "REPOSITORY_CONFIGURATION_FAILED",
        "Repository setup storage could not be initialized.",
        { cause },
      ),
  )();
}
