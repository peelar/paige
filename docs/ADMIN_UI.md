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

The first version is for one authenticated operator and one configured
workspace. Multi-workspace switching, invitations, and roles are later
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

Installation makes the agent reachable. It includes deployment, database
configuration, operator authentication, Vercel Connect clients, provider app
installation, and webhook or trigger attachment.

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

### 3. Authentication

Tracked by [#37](https://github.com/peelar/docs-agent/issues/37).

Protect the web app and its server-side operations with a real single-workspace
operator identity. Production must fail closed. Authentication should establish
the caller boundary that later setup mutations, approvals, and Eve access can
authorize against.

### 4. Shared control-plane services

Tracked by [#38](https://github.com/peelar/docs-agent/issues/38).

Give the agent and web app one app-owned database and service boundary. Move
only the schemas, migrations, setup reads, and signal reads needed by both apps.
The browser never imports database code or raw tables.

### 5. Readiness status

Tracked by [#39](https://github.com/peelar/docs-agent/issues/39).

The first real screen answers one question: is Docs Agent ready?

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

### 6. Work queue

Tracked by [#40](https://github.com/peelar/docs-agent/issues/40).

Show the existing docs signals as the core operational queue. The list should
support the current status and source vocabularies, priority, updated time, next
action, uncertainty, and useful empty or failure states.

### 7. Signal detail

Tracked by [#41](https://github.com/peelar/docs-agent/issues/41).

Show one signal as the complete product record: source provenance, extracted
claims, missing evidence, likely docs surfaces, decision state, lifecycle
events, verification reports, checks, diffs, and draft PR artifacts.

The first queue and detail slices are read-only. Operator mutations can follow
once the read model proves the right interaction shape.

## Later Backlog

The following work stays below the first delivery chain:

- guided workspace setup from the readiness screen ([#42](https://github.com/peelar/docs-agent/issues/42));
- connector installation handoffs and verification ([#43](https://github.com/peelar/docs-agent/issues/43));
- workspace-memory proposal, freshness, promotion, and retirement review ([#44](https://github.com/peelar/docs-agent/issues/44));
- product-level run history and links to deeper Eve or Vercel traces ([#45](https://github.com/peelar/docs-agent/issues/45));
- personality and participation settings after the default behavior is defined
  and covered by evals ([#46](https://github.com/peelar/docs-agent/issues/46));
- a centralized approval inbox ([#47](https://github.com/peelar/docs-agent/issues/47));
- eval results and behavioral regression reporting ([#48](https://github.com/peelar/docs-agent/issues/48));
- schedules, notifications, usage, retention, and data-management controls.

Chat SDK persistence ([#33](https://github.com/peelar/docs-agent/issues/33)),
Slack transport migration ([#34](https://github.com/peelar/docs-agent/issues/34)),
continued thread participation ([#30](https://github.com/peelar/docs-agent/issues/30)),
instruction-boundary cleanup ([#32](https://github.com/peelar/docs-agent/issues/32)),
and technical-editor identity ([#31](https://github.com/peelar/docs-agent/issues/31))
are related agent-runtime work. They remain separate issues and should not be
folded into the web foundation.

## Non-Goals For The First Delivery

- Multi-tenant accounts, invitations, or roles.
- Replacing Slack or Linear as the source of docs signals.
- A raw SQL, table, environment-variable, or workflow-state editor.
- Building a complete tracing backend.
- Silent connector installation or bypassing provider consent.
- Changing agent personality or participation behavior through UI settings
  before those defaults exist and have behavioral eval coverage.

## Success

The first delivery is useful when an authenticated operator can open the app,
understand whether Docs Agent is ready, see the durable work queue, and inspect
the full evidence and lifecycle of one signal without reaching for SQLite or
runtime logs.
