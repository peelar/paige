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

The control plane is for one operator workspace. Local development is bound to
the local machine. A remote deployment uses an allowlisted GitHub identity;
multi-workspace switching, invitations, and roles remain later concerns.

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
database configuration, Vercel Connect clients, provider app installation,
webhook or trigger attachment, and an independently deployed authenticated web
app.

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

### 7. Production operator access

Tracked by [#37](https://github.com/peelar/docs-agent/issues/37).

The independently deployed Next.js app uses Better Auth's GitHub provider and
an eight-hour stateless JWT cookie. The cookie is secure, HTTP-only, same-site,
and scoped to the web origin. The callback accepts only normalized logins in the
server-only allowlist. Every protected page and operation checks that allowlist
again, so removing a login invalidates an existing session without waiting for
expiry.

The app-owned principal is `docs-agent:github:<github-account-id>`, with the
verified GitHub account id, normalized login, and display name available for
later audit events. Provider-owned identity cannot be updated, linked, or
unlinked through browser endpoints. There is no email/password or public signup
path. Missing production configuration returns an unavailable response rather
than anonymous access.

Web authentication does not authenticate Eve. When an operator action later
needs an Eve route, the web server must validate its own session, mint or obtain
a short-lived audience-bound server credential, and call Eve server-to-server.
The Eve channel must verify that credential with a reviewed `AuthFn` or JWT
verifier and map the same app-owned principal into `SessionAuthContext`. The
browser cookie must never be reused across origins.

### 8. Guided workspace onboarding

Tracked by [#42](https://github.com/peelar/docs-agent/issues/42).

The Status page now uses the same repository contract, setup row, GitHub
repository validation, and writeback preflight as the agent. The operator can
set the working GitHub repository, leave the ref at its `main` default, omit the
docs root for checkout-time inference, retain watched repositories, and name the
existing GitHub connector.

Validation does not write. It checks repository access, the ref, an explicit
docs root when present, the GitHub App installation, repository grant, and
writeback permissions. The save action appears only after every required check
passes, and the server repeats those checks before writing. Failed database,
repository, connector, grant, and permission paths remain visible.

One save writes the canonical `workspace_setup` record read by both the web app
and the agent setup gate. It also appends a `workspace_setup_events` snapshot
with the stable authenticated operator id and normalized GitHub login. Watched
repositories are rebuilt server-side with `sandbox-read`, their read-only
action set, and their `watched-repository:<owner>/<repo>` provenance label;
browser input cannot widen that authority. A successful save refreshes the
canonical readiness report.

### 9. Connector installation handoffs

Tracked by [#43](https://github.com/peelar/docs-agent/issues/43).

Slack, Linear, and GitHub now expose connector, provider installation, inbound
trigger, and relevant grant as separate Status-page stages. Each incomplete
stage links to Vercel Connect or displays the installed Eve-supported CLI
command. Browser and provider consent remain human steps; headless setup stops
and says so.

Slack and Linear record a redacted, connector-bound receipt only after a
verified inbound webhook reaches the authored channel. Rechecking the page
turns that receipt into trigger proof without restarting workspace onboarding,
and changing the server-side connector invalidates the old proof. Linear also
uses a real Agent Session as evidence for its assignable or mentionable app
grant. GitHub stays outbound-only in this runtime: its trigger is not
applicable, while its installation, configured repository grant, and write
permissions are checked through the repository-targeted preflight.

### 10. Workspace-memory review

Tracked by [#44](https://github.com/peelar/docs-agent/issues/44).

The authenticated Memories surface now lists and filters proposed, active,
stale, and retired workspace memories. Active records with a future review date,
an expired date, or no date remain visibly different. Detail keeps
model-generated statement and summary text separate from inert provenance text,
safe source links, and chronological lifecycle events.

The agent tools and web app share one control-plane lifecycle service. The web
app projects out workspace ids, provider ids, raw metadata, and unsafe links.
Operators can promote a proposal, mark active context stale, or retire active or
stale context only by providing a reason. The server supplies the authenticated
operator id and calls the existing lifecycle transition; browser input cannot
choose the audit actor or edit memory rows directly. The page repeats that
memory is routing and triage context, never proof for a public docs claim.

## Later Backlog

The following work stays below the first delivery chain:

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
- Remote access without the GitHub allowlist and secure web session.
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
