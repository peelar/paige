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
| Operator app | Local-only Next.js control plane; production deployment is deferred |
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
pnpm eval --list
pnpm dev --no-ui
```

The root commands keep the repository workflow stable while routing work to the
right application. `pnpm dev --no-ui`, `pnpm eval`, and `pnpm db:migrate` target
the Eve app in `apps/agent`. Use `pnpm dev:web` for the minimal Next.js app. The
package-qualified forms are `pnpm --filter docs-agent <command>` and
`pnpm --filter @docs-agent/web <command>`.

The web package uses Playwright Chromium for its desktop and mobile shell smoke
test. Install that browser once after dependencies; `pnpm check` runs the smoke
alongside the production web build.

Put local agent variables in `apps/agent/.env.local` and web-only variables in
`apps/web/.env.local`. Local state still uses `.docs-agent/docs-agent.sqlite` at
the repository root when
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
The current deployed surface is the Eve app:

- set the agent project's Root Directory to `apps/agent`; it owns Eve routes,
  channels, tools, sandboxes, workflow state, and agent runtime variables.

The web app is intentionally local-only for the first control-plane delivery.
`pnpm dev:web` binds it to `127.0.0.1`, and server-side environment such as the
database URL is reported as readiness state rather than used as browser
authentication. Do not deploy or expose it remotely before
[production authentication issue #37](https://github.com/peelar/docs-agent/issues/37)
lands.

## Connect Team Context

Slack uses Eve's Slack channel and Vercel Connect. Set
`DOCS_AGENT_SLACK_CONNECTOR`, or create the default `slack/docs-agent`
connector and attach its trigger to `/eve/v1/slack`. Paige handles explicit app
mentions and DMs, fetches new thread context, and records substantive threads as
documentation signals.

Linear uses Eve's Linear Agent Session channel and Vercel Connect. Set
`DOCS_AGENT_LINEAR_CONNECTOR`, or create the default `linear/docs-agent`
connector and attach its trigger to `/eve/v1/linear`. Paige handles delegated or
prompted Agent Sessions without crawling or editing Linear issues.

See [Paige's identity and asset guide](./docs/IDENTITY.md) for the visual assets
and the manual Slack display-name and avatar setup.
