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

```sh
pnpm install
mkdir -p .paige
export PAIGE_DATABASE_URL=file:.paige/paige.db
export PAIGE_OPERATOR_WORKSPACE_ID=<your-slack-workspace-id>
pnpm eval
pnpm dev
```

On the first Slack direct message, Paige offers to connect one documentation
repository and any optional product repositories it should use as evidence.
Paige checks access, shows the complete setup, and saves it only after
confirmation. The active setup is shared by everyone in the Slack workspace.
The local web app can connect or replace the documentation repository with one
GitHub URL for the workspace selected by `PAIGE_OPERATOR_WORKSPACE_ID`.

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
| Repositories        | Slack workspace setup for one writable documentation repository and optional read-only evidence repositories |
| Isolation           | Eve sandbox with Git object caches under `/workspace/repositories`                       |
| Durable state       | Drizzle with local SQLite or a deployed libSQL-compatible database                      |
| Writeback           | Digest-bound documentation diff followed by an explicitly approved branch and draft PR   |
| Regression proof    | Unit tests and live Eve evals for onboarding, repository inspection, and documentation authoring |
