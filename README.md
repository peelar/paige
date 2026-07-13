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
pnpm eval --list
pnpm dev
```

`pnpm dev` starts the Eve app and operator app together. Use
`pnpm dev:agent --no-ui` or `pnpm dev:web` to run one app by itself.
Portless keeps their local addresses stable while assigning internal ports:

| App | Local address |
| --- | --- |
| Operator UI | <http://paige.localhost:1355> |
| Eve agent | <http://agent.paige.localhost:1355> |

## Guides

- [Local development](./docs/DEVELOPMENT.md)
- [Vercel deployment](./docs/DEPLOYMENT.md)
- [Slack and Linear](./docs/TEAM_CONTEXT.md)

Maintainer documentation lives under [`docs/internal`](./docs/internal/MANIFEST.md).
