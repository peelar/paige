<div align="center">
  <img src="./assets/paige/paige-magpie-512.png" alt="Paige, the documentation agent" width="320" />

  <h1>Paige</h1>

  <p><strong>A documentation agent that follows the work and keeps your docs accurate.</strong></p>
</div>

Paige is an open-source documentation agent for software teams. Product truth
rarely arrives as a tidy writing task: it is scattered across Slack threads,
Linear issues, releases, pull requests, and support notes. Paige follows those
signals, checks what the documentation actually says, and keeps the public story
accurate.

Paige starts with a documentation impact report. The result may be a small
Markdown or MDX patch, a changelog entry, no documentation change, or a question
for a maintainer. Patches are prepared and checked in an isolated repository
workspace, and publishing remains behind explicit approval.

## How It Works

```text
Slack · Linear · Releases · Repositories
                    ↓
             Provenance and evidence
                    ↓
        Documentation impact decision
                    ↓
    No change · Question · Changelog · Patch
                    ↓
             Approved draft PR
```

## Technical Overview

| Concern | Implementation |
| --- | --- |
| Agent runtime | [Eve](https://eve.dev) |
| Operator app | Next.js control plane with explicit local access or allowlisted GitHub authentication |
| Workspace | pnpm and Turborepo with `apps/agent` and `apps/web` |
| Team context | Explicit Slack mentions and Linear Agent Sessions |
| Repository evidence | GitHub working repository plus optional read-only watched repositories |
| Isolation | Eve sandbox with the working documentation repository at `/workspace/working-docs` |
| Durable state | Drizzle with local SQLite or a deployed libSQL-compatible database |
| Writeback | Small checked diff, followed by an explicitly approved branch and draft PR |
| Regression proof | Live Eve evals covering patches, no-change decisions, signals, safety, and conversation |

## Run Locally

Use Node 24.18.0.

```sh
pnpm install
pnpm --filter @docs-agent/web exec playwright install chromium
pnpm check
pnpm status:smoke
pnpm eval --list
pnpm dev --no-ui
```

The root commands keep the repository workflow stable while routing work to the
right package. `pnpm dev --no-ui` and `pnpm eval` target the Eve app in
`apps/agent`; `pnpm db:migrate` targets the shared control-plane package that
owns the schema and migrations. Use `pnpm dev:web` for the Next.js operator app.
The package-qualified forms use `docs-agent`, `@docs-agent/control-plane`, and
`@docs-agent/web`.

The web package uses Playwright Chromium for its desktop and mobile shell smoke
test. Install that browser once after dependencies; `pnpm check` runs the smoke
alongside the production web build.

The Status page checks Eve at `http://127.0.0.1:2000` by default, matching
`pnpm dev --no-ui`. Set `DOCS_AGENT_EVE_URL` server-side when the runtime uses a
different origin. The browser receives only the redacted readiness report.
An authenticated operator can also validate and save the working repository,
optional watched repositories, and GitHub writeback connector from that page.
Validation is read-only; failed repository, ref, docs-root, installation,
repository-grant, or permission checks are shown before anything is saved.
The Memories page lists proposed, active, stale, and retired routing context,
keeps provenance separate from generated memory text, and records authenticated
promotion, stale, and retirement decisions as append-only lifecycle events.
The Runs page indexes the product operations behind signals and owned work. It
shows safe status, timing, model, usage, and step projections, then links to the
durable Eve stream or supported external traces without copying messages,
reasoning, model output, or tool payloads into the product database. Run
metadata expires after 30 days. Use
`pnpm --filter docs-agent test:run-index:integration` to exercise the contract
against a real local Eve session backed by a deterministic fixture model.

Put local agent variables in `apps/agent/.env.local` and web-only variables in
`apps/web/.env.local`. Both apps resolve local state through
`@docs-agent/control-plane` and use `.docs-agent/docs-agent.sqlite` at the
repository root when
`DOCS_AGENT_DATABASE_URL` is not set. A deployed runtime must set
`DOCS_AGENT_DATABASE_URL` and, when required by the provider,
`DOCS_AGENT_DATABASE_AUTH_TOKEN`. Missing required persistence fails visibly
before documentation work continues.

`pnpm dev` and `pnpm start` migrate the agent database before Eve starts. A
Vercel build runs the same committed Drizzle migrations before producing the
deployment. For any other installation or deployment workflow, run
`pnpm db:migrate` explicitly before starting the agent. Ordinary database reads
and writes only validate schema readiness; they fail on a fresh, stale, or
partial schema and never apply migrations as a side effect.

## Deploy On Vercel

The repository root owns workspace orchestration and is not a deployable app.
Create two projects from this repository:

- set the agent project's Root Directory to `apps/agent`; it owns Eve routes,
  channels, tools, sandboxes, workflow state, and agent runtime variables.
- set the operator project's Root Directory to `apps/web`; it owns authenticated
  pages, server-side control-plane reads, and audited operator mutations. Run
  the committed database
  migrations before either app uses a new schema.

The operator deployment requires `DOCS_AGENT_OPERATOR_ACCESS=github`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, and the server-only comma-separated
`DOCS_AGENT_APPROVED_GITHUB_LOGINS`. Set `BETTER_AUTH_URL` to the operator
deployment origin and register
`<BETTER_AUTH_URL>/api/auth/callback/github` as the GitHub OAuth callback. Give
the web project the same `DOCS_AGENT_DATABASE_URL` and, when applicable,
`DOCS_AGENT_DATABASE_AUTH_TOKEN` as the agent project. Missing or invalid auth
configuration leaves protected access unavailable.

`pnpm dev:web` remains the explicit local path. It binds to `127.0.0.1` and
selects local operator access; local and test modes are rejected on a Vercel
production deployment. The GitHub session cookie belongs only to the web
origin. It is not an Eve credential and must not be forwarded to the separately
deployed runtime.

## Connect Team Context

Slack uses Eve's Chat SDK channel, the Chat SDK Slack adapter, and Vercel
Connect. Set
`DOCS_AGENT_SLACK_CONNECTOR`, or create the default `slack/docs-agent`
connector and attach its trigger to `/eve/v1/slack`. Paige handles explicit app
mentions and DMs, fetches new thread context, and records substantive threads as
documentation signals. An accepted mention also enrolls that thread for scoped
participation: Paige answers useful follow-ups, observes unrelated conversation
silently, and stops after dismissal, signal resolution, or seven days of
inactivity. The Slack app must subscribe to `app_mention`,
`message.im`, `message.channels`, and `message.groups`, with matching history,
write, and user-read scopes. Ordinary channel messages are discarded at the
adapter boundary unless their thread has active presence and a Chat SDK
subscription. During a fresh user-triggered Slack turn, Paige can use Slack
Real-time Search once to fill a concrete context gap. Add `search:read.public`
and any deliberately supported private, MPIM, or DM search scopes to the Slack
app; those private surfaces still require the requesting user's Slack consent.
Search uses the event's request-scoped `action_token`, returns only a derived
summary and source permalinks to Eve, and never stores raw search results.

Linear uses Eve's Linear Agent Session channel and Vercel Connect. Set
`DOCS_AGENT_LINEAR_CONNECTOR`, or create the default `linear/docs-agent`
connector and attach its trigger to `/eve/v1/linear`. Paige handles delegated or
prompted Agent Sessions without crawling or editing Linear issues.

The authenticated Status page shows connector, installation, trigger, and
repository or provider grant separately. It displays the supported Vercel
Connect handoff, records only real verified Slack or Linear delivery, and can
recheck completed browser or CLI actions without restarting workspace setup.
Provider consent and administrator approval remain explicit human steps. See
[Connector Installation Handoffs](./docs/USER_TESTING.md#connector-installation-handoffs).

See [Paige's identity and asset guide](./docs/IDENTITY.md) for the visual assets
and the manual Slack display-name and avatar setup.
