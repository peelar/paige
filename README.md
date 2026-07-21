<div align="center">
  <img src="./assets/paige/paige-magpie-512.png" alt="Paige, the documentation agent" width="320" />

  <h1>Paige</h1>

  <p><strong>A documentation agent that decides what should change—and what should not.</strong></p>
</div>

Paige is an open-source documentation agent for software teams. Bring it a
product signal from a conversation, issue, release, or repository. Paige checks
what the documentation and source evidence actually say before deciding whether
anything should change.

Paige is currently under heavy development. Feel free to follow along.

## Get Started

Ask your coding agent to **use the
[`$setup`](./.agents/skills/setup/SKILL.md) skill to prepare the checkout for
local development**. It installs dependencies, pulls the linked Vercel
production environment, connects the shared Turso database, and verifies the
coding harness. Then run `pnpm dev` to start the local operator app. Its chat
connects to the production Paige agent through a server-side authenticated
proxy; run `pnpm dev:agent` separately only when working on the agent runtime.
Use the [Slack preview workflow](./docs/SLACK_PREVIEW.md) to exercise local
agent changes from a dedicated Slack bot without deploying them first.

Paige requires the shared Turso database provisioned through the linked Vercel
project. Local development does not silently create a separate database.

On the first Slack direct message, Paige offers to connect one documentation
repository and any optional product repositories it should use as evidence.
Paige checks access, shows the complete setup, and saves it only after
confirmation. The active setup belongs to the Paige agent, regardless of
whether a request arrives from Slack, Linear, Teams, or the local web app. The
local web app can connect or replace the documentation repository with one
GitHub URL.

## How It Works

```text
Slack · Linear · Releases · Repositories
                    ↓
       Bounded, attributable evidence
                    ↓
      Answer · Abstain · Recommendation
                    │ explicit docs request
                    ↓
         Documentation decision
                    ↓
       No change · Question · Changelog · Patch
                    │ patch + approval
                    ↓
             Approved draft PR
```

## Technical Overview

| Concern             | Implementation                                                                          |
| ------------------- | --------------------------------------------------------------------------------------- |
| Agent runtime       | [Eve](https://eve.dev)                                                                  |
| Operator app        | Next.js control plane with explicit local access or allowlisted GitHub authentication   |
| Workspace           | pnpm and Turborepo with `apps/agent` and `apps/web`                                     |
| Team context        | Explicit Slack mentions and Linear Agent Sessions                                       |
| Repositories        | One agent-level setup for a writable documentation repository and optional read-only evidence repositories |
| Isolation           | Eve sandbox with Git object caches under `/workspace/repositories`                       |
| Durable state       | Drizzle with local SQLite or a deployed libSQL-compatible database                      |
| Writeback           | Digest-bound documentation diff followed by an explicitly approved branch and draft PR   |
| Regression proof    | Unit tests and [live Eve evals](./EVALS.md) for behavior, safety, and repository integration       |
