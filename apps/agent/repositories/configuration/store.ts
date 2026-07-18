import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResultAsync } from "../shared/errors";
import { repositoryConfiguration } from "./schema";
import type {
  ActiveRepositoryConfiguration,
  SaveRepositoryConfigurationInput,
} from "./types";

export interface RepositoryConfigurationStore {
  get(): RepositoryResultAsync<ActiveRepositoryConfiguration | undefined>;
  save(
    input: SaveRepositoryConfigurationInput,
  ): RepositoryResultAsync<ActiveRepositoryConfiguration>;
}

export class LibsqlRepositoryConfigurationStore
  implements RepositoryConfigurationStore {
  readonly #database;
  readonly #ready: Promise<void>;

  constructor(client: Client) {
    this.#database = drizzle(client);
    this.#ready = createSchema(client);
  }

  get(): RepositoryResultAsync<ActiveRepositoryConfiguration | undefined> {
    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        const [row] = await this.#database
          .select()
          .from(repositoryConfiguration)
          .where(eq(repositoryConfiguration.id, 1))
          .limit(1);
        return row === undefined ? undefined : fromRow(row);
      }),
      configurationStoreError,
    );
  }

  save(
    input: SaveRepositoryConfigurationInput,
  ): RepositoryResultAsync<ActiveRepositoryConfiguration> {
    const updatedAt = new Date().toISOString();
    const nextRevision = (input.expectedRevision ?? 0) + 1;

    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        if (input.expectedRevision === null) {
          return await this.#database
            .insert(repositoryConfiguration)
            .values({
              id: 1,
              configuration: input.configuration,
              revision: nextRevision,
              updatedAt,
            })
            .onConflictDoNothing({
              target: repositoryConfiguration.id,
            })
            .returning();
        }

        return await this.#database
          .update(repositoryConfiguration)
          .set({
            configuration: input.configuration,
            revision: nextRevision,
            updatedAt,
          })
          .where(eq(repositoryConfiguration.revision, input.expectedRevision))
          .returning();
      }),
      configurationStoreError,
    ).andThen(([row]) =>
      row === undefined
        ? err(new RepositoryError(
            "REPOSITORY_CONFLICT",
            "The repository setup changed before it could be saved. Review the latest setup and try again.",
          ))
        : ok(fromRow(row))
    );
  }
}

async function createSchema(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS agent_repository_configuration (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      configuration TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function fromRow(
  row: typeof repositoryConfiguration.$inferSelect,
): ActiveRepositoryConfiguration {
  return {
    ...row.configuration,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

function configurationStoreError(cause: unknown): RepositoryError {
  return new RepositoryError(
    "REPOSITORY_CONFIGURATION_FAILED",
    "Repository setup could not be loaded or saved.",
    { cause },
  );
}
