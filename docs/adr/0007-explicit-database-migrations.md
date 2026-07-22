# ADR-0007: Explicit database migrations

Status: Accepted
Date: 2026-07-22

## Context

Paige's repository setup, session index, and Slack coordination state share one
libSQL database. Each runtime adapter used to create its own tables on first
use. That hid schema changes inside requests, made deployment order unclear,
and gave production code permission to mutate database structure.

## Decision

Committed Drizzle migrations under `database/migrations` are the only schema
writer. Operators apply them with `pnpm db:migrate`, and the checkout setup flow
applies them after writing the agent-owned database environment. Runtime stores
perform read-only schema checks and fail when a required migration is missing.

The initial migration uses idempotent table and index creation so it can adopt
databases created by earlier Paige versions without deleting or rewriting data.
Tests start with empty databases and apply the committed migrations explicitly.

## Consequences

- Schema changes are reviewable and run before application traffic.
- A missing migration fails closed instead of being repaired by a request.
- Existing Paige databases can adopt the migration ledger safely.
- Future schema changes require a generated migration and an explicit apply step.
