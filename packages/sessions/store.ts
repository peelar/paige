import type { Client } from "@libsql/client";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { ResultAsync } from "neverthrow";

import { AgentSessionError } from "./errors.js";
import type { AgentSessionResultAsync } from "./errors.js";
import { agentSessions } from "./schema.js";
import type {
  AgentSessionSource,
  IndexedAgentSession,
  ListAgentSessionsInput,
  UpdateAgentSessionLifecycleInput,
} from "./types.js";

interface StoreAgentSessionInput {
  sessionId: string;
  source: AgentSessionSource;
  title: string;
  registeredAt?: string;
}

export interface AgentSessionStore {
  get(
    sessionId: string,
  ): AgentSessionResultAsync<IndexedAgentSession | undefined>;
  list(
    input?: ListAgentSessionsInput,
  ): AgentSessionResultAsync<IndexedAgentSession[]>;
  register(
    input: StoreAgentSessionInput,
  ): AgentSessionResultAsync<IndexedAgentSession>;
  updateLifecycle(
    input: UpdateAgentSessionLifecycleInput,
  ): AgentSessionResultAsync<void>;
}

export class LibsqlAgentSessionStore implements AgentSessionStore {
  readonly #database;
  readonly #ready: Promise<void>;

  constructor(client: Client) {
    this.#database = drizzle(client);
    this.#ready = verifySchema(client);
  }

  get(
    sessionId: string,
  ): AgentSessionResultAsync<IndexedAgentSession | undefined> {
    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        const [row] = await this.#database
          .select()
          .from(agentSessions)
          .where(and(
            eq(agentSessions.sessionId, sessionId),
            isNotNull(agentSessions.source),
            isNotNull(agentSessions.title),
          ))
          .limit(1);
        return row === undefined ? undefined : completeRow(row);
      }),
      sessionStoreError,
    );
  }

  list(
    input: ListAgentSessionsInput = {},
  ): AgentSessionResultAsync<IndexedAgentSession[]> {
    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        const visible = and(
          isNotNull(agentSessions.source),
          isNotNull(agentSessions.title),
          input.source === undefined
            ? undefined
            : eq(agentSessions.source, input.source),
        );
        const rows = await this.#database
          .select()
          .from(agentSessions)
          .where(visible)
          .orderBy(desc(agentSessions.updatedAt));
        return rows.map(completeRow);
      }),
      sessionStoreError,
    );
  }

  register(
    input: StoreAgentSessionInput,
  ): AgentSessionResultAsync<IndexedAgentSession> {
    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        const registeredAt = input.registeredAt ?? new Date().toISOString();
        const [row] = await this.#database
          .insert(agentSessions)
          .values({
            sessionId: input.sessionId,
            source: input.source,
            title: input.title,
            status: "running",
            startedAt: registeredAt,
            updatedAt: registeredAt,
          })
          .onConflictDoUpdate({
            target: agentSessions.sessionId,
            set: {
              // Lifecycle events can create the row first. Registration only fills
              // channel metadata and never rolls the lifecycle backward.
              source: sql`COALESCE(${agentSessions.source}, excluded.source)`,
              title: sql`COALESCE(${agentSessions.title}, excluded.title)`,
            },
          })
          .returning();
        if (row === undefined) {
          throw new AgentSessionError(
            "AGENT_SESSION_STORAGE_FAILED",
            "The agent session was not registered.",
          );
        }
        return completeRow(row);
      }),
      sessionStoreError,
    );
  }

  updateLifecycle(
    input: UpdateAgentSessionLifecycleInput,
  ): AgentSessionResultAsync<void> {
    return ResultAsync.fromPromise(
      this.#ready.then(async () => {
        const status = input.status ?? "running";
        const values = {
          sessionId: input.sessionId,
          status,
          startedAt: input.occurredAt,
          updatedAt: input.occurredAt,
        };

        if (input.status === undefined) {
          await this.#database
            .insert(agentSessions)
            .values(values)
            .onConflictDoUpdate({
              target: agentSessions.sessionId,
              set: { updatedAt: input.occurredAt },
            });
          return;
        }

        await this.#database
          .insert(agentSessions)
          .values(values)
          .onConflictDoUpdate({
            target: agentSessions.sessionId,
            set: { status: input.status, updatedAt: input.occurredAt },
          });
      }),
      sessionStoreError,
    );
  }
}

async function verifySchema(client: Client): Promise<void> {
  // Runtime code must never mutate schema. This read makes a missing migration
  // fail at the storage boundary with the normal typed session error.
  await client.execute(`
    SELECT session_id, source, title, status, started_at, updated_at
    FROM agent_sessions
    LIMIT 0
  `);
}

function completeRow(
  row: typeof agentSessions.$inferSelect,
): IndexedAgentSession {
  if (row.source === null || row.title === null) {
    throw new Error("Agent session metadata is incomplete.");
  }
  return {
    sessionId: row.sessionId,
    source: row.source,
    title: row.title,
    status: row.status,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  };
}

function sessionStoreError(cause: unknown): AgentSessionError {
  return cause instanceof AgentSessionError
    ? cause
    : new AgentSessionError(
      "AGENT_SESSION_STORAGE_FAILED",
      "The agent session index could not be read or updated.",
      { cause },
    );
}
