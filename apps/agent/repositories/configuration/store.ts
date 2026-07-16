import type { Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { err, ok, ResultAsync } from "neverthrow";

import { RepositoryError } from "../shared/errors";
import type { RepositoryResultAsync } from "../shared/errors";
import { repositoryConfigurations } from "./schema";
import type {
  ActiveRepositoryConfiguration,
  SaveRepositoryConfigurationInput,
} from "./types";

interface RepositoryConfigurationStore {
  get(
    workspaceId: string,
  ): RepositoryResultAsync<ActiveRepositoryConfiguration | undefined>;
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

  get(
    workspaceId: string,
  ): RepositoryResultAsync<ActiveRepositoryConfiguration | undefined> {
    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        const [row] = await this.#database
          .select()
          .from(repositoryConfigurations)
          .where(eq(repositoryConfigurations.workspaceId, workspaceId))
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
            .insert(repositoryConfigurations)
            .values({
              workspaceId: input.workspaceId,
              configuration: input.configuration,
              revision: nextRevision,
              updatedAt,
            })
            .onConflictDoNothing({
              target: repositoryConfigurations.workspaceId,
            })
            .returning();
        }

        return await this.#database
          .update(repositoryConfigurations)
          .set({
            configuration: input.configuration,
            revision: nextRevision,
            updatedAt,
          })
          .where(and(
            eq(repositoryConfigurations.workspaceId, input.workspaceId),
            eq(repositoryConfigurations.revision, input.expectedRevision),
          ))
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
    CREATE TABLE IF NOT EXISTS repository_configurations (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      configuration TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function fromRow(
  row: typeof repositoryConfigurations.$inferSelect,
): ActiveRepositoryConfiguration {
  return {
    workspaceId: row.workspaceId,
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
