# Admin UI

Status: Internal product plan

## Purpose

Docs Agent needs a small web control plane around the durable state it already
owns. The first useful product is not a generic dashboard. It is a place to see
whether the agent is ready, inspect the docs work it has collected, and
understand what happened to each signal.

The web app complements Slack, Linear, the Eve terminal UI, and the agent
itself. It does not replace them as the place where documentation work starts.

## Product Boundary

The first version is for one local operator and one configured workspace. It is
bound to the local machine and is not a production deployment. Remote access,
authentication, multi-workspace switching, invitations, and roles are later
concerns.

The UI is an application surface, not a database editor. It uses the same typed
setup, signal, memory, and workflow services as the agent. Mutations must keep
their validation, lifecycle events, provenance, and approval boundaries.

The control plane owns product state and product-level observability. Eve,
Vercel Workflow, and OpenTelemetry remain the deeper execution and trace
surfaces. The app may index or link to those runs, but it should not read
`.workflow-data` as a product API or build a second workflow engine.

## Repository Shape

The repository becomes a pnpm and Turborepo monorepo with two deployable apps:

```text
apps/
  agent/  # Eve runtime, channels, tools, skills, evals, sandbox
  web/    # Next.js operator control plane
packages/
  ...     # app-owned code shared only when both apps need it
```

The structural move should preserve current agent behavior and keep the root
`pnpm check` command authoritative. Shared packages should be introduced from
real reuse. The first expected boundary is database and control-plane services
needed by both apps; the monorepo conversion should not extract the whole agent
into speculative packages.

See [ADR-0002](./adr/0002-turborepo-agent-and-web-apps.md).

## Onboarding Model

There is one versioned setup model with several interfaces. The CLI, web app,
and agent must not become separate setup systems.

```text
installation ready -> channel reachable -> workspace ready -> first useful signal
```

### Installation

Installation makes the agent reachable. For the local-first delivery it includes
database configuration, Vercel Connect clients, provider app installation, and
webhook or trigger attachment. Web deployment and operator authentication are a
later slice.

App-scoped Slack, Linear, and GitHub credentials must exist before those
surfaces can wake or authorize the agent. This cannot be deferred to the first
message on the channel that is still missing. Interactive CLI and browser
handoffs are the current default. A headless flow must stop with a clear human
action instead of pretending setup succeeded.

Vercel Connect is the credential and trigger boundary here. Runtime OAuth
prompts remain useful for user-scoped outbound connections in an existing Eve
session, but they are not the bootstrap mechanism for app-scoped channel
installation.

### Workspace setup

Once one surface can reach Docs Agent, the agent or the web app can collect the
working documentation repository, watched repositories, and GitHub writeback
configuration. Both interfaces use the same persisted setup services and show
the same readiness result.

The existing defaults remain: use `main` when a ref is omitted, infer the docs
root after materialization, and fail visibly when required storage, access, or
permissions are unavailable.

### Progressive setup

Personality, participation policy, workspace memories, schedules, and
notification preferences should come after the first useful signal. They are
not prerequisites for seeing the product work.

See [ADR-0003](./adr/0003-hybrid-installation-and-workspace-onboarding.md).

## First Delivery Chain

### 1. Monorepo boundary

Tracked by [#35](https://github.com/peelar/docs-agent/issues/35).

Move the current Eve app into `apps/agent`, add a minimal Next.js app at
`apps/web`, and make root development, build, test, typecheck, and validation
commands run through Turborepo. This is a structural change only.

### 2. Web foundation

Tracked by [#36](https://github.com/peelar/docs-agent/issues/36).

Add the operator application shell, navigation, loading and failure states, and
the minimum design system needed for later screens. Do not fill the shell with
mock operational data.

### 3. Shared control-plane services

Tracked by [#38](https://github.com/peelar/docs-agent/issues/38).

The agent and web app now share `@docs-agent/control-plane`. That server-only
package owns the Drizzle schema, migrations, setup persistence, and typed signal
list and detail reads. Agent tools remain thin adapters over those services, and
the browser cannot import the package's agent or raw database entrypoints.

### 4. Readiness status

Tracked by [#39](https://github.com/peelar/docs-agent/issues/39).

The first real screen now answers one question: is Docs Agent ready?

It should distinguish configured, reachable, verified, blocked, and unknown for
at least:

- application database and migrations;
- working documentation repository;
- GitHub writeback connector and repository grant;
- Slack connector and inbound route;
- Linear connector and inbound route;
- Eve runtime health.

Each failed or incomplete check needs a concrete next action. The first slice is
read-only: it reports and links to remediation without trying to provision every
provider.

The implementation uses one table-driven readiness vocabulary across the
shared control-plane service and the Status page. Database and migration checks,
canonical workspace setup, repository-targeted GitHub preflight, Slack and
Linear provider calls, and Eve's public health endpoint all run server-side.
Reachable providers remain distinct from verified inbound delivery, and every
rendered item includes its source, last check time, and next action.

### 5. Work queue

Tracked by [#40](https://github.com/peelar/docs-agent/issues/40).

The Signals page now shows existing docs signals as the core operational queue.
It uses a dedicated shared-service projection that includes only the signal id,
current status, source kind, operator-safe summary, priority, uncertainty, next
action time, and updated time. Raw source records, provider identity and
metadata, workspace ids, and dedupe keys stay outside the browser contract.

Open work is the default. Operators can filter by the existing status and
source vocabularies or explicitly include closed work. Results sort by priority,
then updated time, then stable id. Loading, empty, database failure, and invalid
persisted-record states remain visible and read-only. Each summary opens the
stable `/signals/<id>` detail route.

### 6. Signal detail

Tracked by [#41](https://github.com/peelar/docs-agent/issues/41).

The detail route now shows one signal as the complete product record: source
provenance, extracted claims, missing evidence, likely docs surfaces, decision
state, chronological lifecycle events, safe related links, verification
reports, checks, diffs, and draft PR artifacts.

A dedicated operator projection removes workspace, provider, and dedupe ids;
redacts credential-shaped metadata recursively; and accepts only HTTPS links
without embedded credentials or sensitive query parameters. Verbatim source
text is clearly separated from the model-generated summary and claims, and is
rendered as inert text. Missing, corrupt, unauthorized, and database-failure
states are explicit.

The first queue and detail slices are read-only. Operator mutations can follow
once the read model proves the right interaction shape.

## Later Backlog

The following work stays below the first delivery chain:

- production deployment and single-workspace authentication
  ([#37](https://github.com/peelar/docs-agent/issues/37));
- guided workspace setup from the readiness screen ([#42](https://github.com/peelar/docs-agent/issues/42));
- connector installation handoffs and verification ([#43](https://github.com/peelar/docs-agent/issues/43));
- workspace-memory proposal, freshness, promotion, and retirement review ([#44](https://github.com/peelar/docs-agent/issues/44));
- product-level run history and links to deeper Eve or Vercel traces ([#45](https://github.com/peelar/docs-agent/issues/45));
- personality and participation settings after the default behavior is defined
  and covered by evals ([#46](https://github.com/peelar/docs-agent/issues/46));
- a centralized approval inbox ([#47](https://github.com/peelar/docs-agent/issues/47));
- durable, redacted eval and validation result recording ([#50](https://github.com/peelar/docs-agent/issues/50));
- eval results and behavioral regression reporting backed by those records ([#48](https://github.com/peelar/docs-agent/issues/48));
- schedules, notifications, usage, retention, and data-management controls.

Chat SDK persistence ([#33](https://github.com/peelar/docs-agent/issues/33)) and
Slack transport migration ([#34](https://github.com/peelar/docs-agent/issues/34))
and continued thread participation
([#30](https://github.com/peelar/docs-agent/issues/30)) are complete runtime
foundations. Bounded Slack context retrieval
([#49](https://github.com/peelar/docs-agent/issues/49)) is also complete without
adding an operator persistence surface. Instruction-boundary cleanup ([#32](https://github.com/peelar/docs-agent/issues/32)),
and technical-editor identity ([#31](https://github.com/peelar/docs-agent/issues/31))
are related agent-runtime work. They remain separate issues and should not be
folded into the web foundation.

## Non-Goals For The First Delivery

- Multi-tenant accounts, invitations, or roles.
- Production deployment or remote access to the unauthenticated local operator
  app.
- Replacing Slack or Linear as the source of docs signals.
- A raw SQL, table, environment-variable, or workflow-state editor.
- Building a complete tracing backend.
- Silent connector installation or bypassing provider consent.
- Changing agent personality or participation behavior through UI settings
  before those defaults exist and have behavioral eval coverage.

## Success

The first delivery is useful when a local operator can open the app,
understand whether Docs Agent is ready, see the durable work queue, and inspect
the full evidence and lifecycle of one signal without reaching for SQLite or
runtime logs.
