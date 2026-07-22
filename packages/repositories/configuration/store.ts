import type { Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "../errors.js";
import type { RepositoryResultAsync } from "../errors.js";
import { repositoryConfiguration } from "./schema.js";
import type {
  ActiveRepositoryConfiguration,
  SaveRepositoryConfigurationInput,
} from "./types.js";

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
    this.#ready = verifySchema(client);
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

async function verifySchema(client: Client): Promise<void> {
  // Schema changes belong to the explicit migration command, not a request.
  await client.execute(`
    SELECT id, configuration, revision, updated_at
    FROM agent_repository_configuration
    LIMIT 0
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
