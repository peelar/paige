# ADR-0001: Persist Docs Signals In An App-Owned Database

Status: Accepted
Date: 2026-07-09
Supersedes: None

## Context

The Slack and Linear milestone needs durable docs signals and workflow state
before it adds channel intake. A signal can start in a Slack thread, gain
clarity from a Linear issue, pick up evidence from a watched repository scan,
then later produce a working-documentation-repository verification run and
patch handoff. That state has to survive restarts and deployments, be queryable
across sessions, support dedupe, and keep provider provenance separate from the
working documentation repository.

The existing `.docs-agent/config.json` setup state is intentionally narrow. It
stores reusable workspace setup such as the configured working documentation
repository and watched repositories. It is not the right boundary for
multi-channel mutable workflow state.

Eve session state is also not the right boundary. Eve `defineState` is durable
per-session working memory, while docs signals must be available across
sessions, channels, schedules, and future users or workspaces.

## Decision

Docs signals and workflow state will live in an app-owned database behind a
small persistence interface. The first implementation should use Drizzle as the
typed schema and query layer with a SQLite-compatible backend.

The intended storage shape is:

- local development: Drizzle with `@libsql/client` against a local SQLite file;
- deployed runtime: the same Drizzle schema through libSQL, with Turso Cloud as
  the likely managed SQLite-compatible database if hosted persistence is needed;
- future portability: keep the storage contract app-owned so another SQL
  backend can replace the physical database without changing the agent-facing
  signal workflow.

Use Drizzle migrations as the schema authority for implementation work. During
early prototyping, direct schema push is acceptable for local development only;
reviewable generated migrations should become the default once signal tables
start carrying real workflow state.

Do not use repo-local JSON, GitHub issues/comments, Slack messages, Linear
activities, or Eve session state as the product source of truth for signals.
Those surfaces can remain inputs, provenance, delivery channels, or local-dev
fixtures, but not the durable workflow store.

## Storage Needs

The first schema should be small but should not paint the app into a corner.
The database needs to represent:

- workspaces: the future tenant or workspace boundary for configured docs work;
- docs signals: provider-neutral work items with status, extracted claim,
  uncertainty, priority, capture time, update time, and optional next action
  time;
- signal sources: Slack thread, Linear issue, watched release, scheduled scan,
  or manual/external context records with provider ids and permalinks;
- signal links: related repositories, releases, PRs, Linear issues, Slack
  threads, and other cross-source references;
- verification runs: sandbox/docs verification attempts, checked refs,
  considered docs pages, outcome, report summary, and check status;
- workflow events: append-only status transitions and audit entries for
  maintainer questions, skipped verification, patch preparation, draft PR
  handoff, and closure reasons;
- artifact references: pointers to diff, report, and check artifacts rather than
  large blobs in the signal row.

The minimum query shape needs:

- provider dedupe by workspace, provider, and provider external id;
- claim or release dedupe by workspace and stable dedupe key;
- work queue lookup by workspace, status, priority, and updated time;
- scheduled follow-up lookup by workspace and next action time;
- audit and run lookup by signal id and creation time.

## Failure Behavior

Signal persistence must fail visibly. If the database URL, token, migration
state, or schema version is missing or stale, the app should refuse signal
capture, queue processing, verification handoff, and status mutation instead of
dropping or partially recording work.

If the database is unavailable, the agent may still answer a one-off prompt from
provided context, but it must say that durable signal capture or workflow state
is unavailable. It must not pretend that a Slack or Linear signal was queued.

If persisted state is corrupt or fails schema validation, stop the signal
workflow and surface an operator-facing setup/storage problem. Do not repair or
migrate silently from the model path.

## Why Drizzle And SQLite-Compatible Storage

Drizzle keeps the TypeScript schema, query code, and migrations close to this
Eve app without adding a broad application framework. Its SQLite/libSQL support
matches the small relational shape needed for signals, events, dedupe keys, and
status queries.

SQLite-compatible storage is enough for the first signal queue. The expected
workload is low write volume, indexed queue reads, append-only event history,
and small structured records. It does not need a heavyweight database service
before Slack and Linear workflows prove product value.

Turso is worth evaluating as the first deployed backend because Turso Cloud is
SQLite-compatible, runs through libSQL, supports scoped access tokens, backups
and point-in-time recovery, usage visibility, branching, and a Platform API for
future database-per-workspace or database-per-agent models. The app should
depend on the libSQL/Drizzle interface, not on Turso-specific product behavior
unless a later issue explicitly chooses it.

## Consequences

- Signal work can be implemented as ordinary typed database operations instead
  of prompt memory, provider comments, or repo-local files.
- Local development stays cheap and inspectable through a SQLite file.
- Deployed Slack and Linear intake get a realistic persistence path without
  introducing a large data platform.
- `.docs-agent/config.json` remains setup state only until a later migration
  moves workspace setup into the same database boundary.
- The next implementation issue must add the store interface, Drizzle schema,
  migrations, setup checks, and focused tests before channel intake writes
  signals.

## Links

- GitHub issue: https://github.com/peelar/docs-agent/issues/20
- Repository model: ../REPOSITORY_MODEL.md
- Roadmap: ../ROADMAP.md
- Drizzle SQLite docs: https://orm.drizzle.team/docs/get-started/sqlite-new
- Drizzle migrations docs: https://orm.drizzle.team/docs/migrations
- Turso Drizzle docs: https://docs.turso.tech/sdk/ts/orm/drizzle
- Turso Cloud docs: https://docs.turso.tech/turso-cloud
- Turso Platform API docs: https://docs.turso.tech/api-reference/introduction
