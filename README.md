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
pnpm eval
pnpm dev
```

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
| Repository evidence | GitHub working repository plus optional read-only watched repositories                  |
| Isolation           | Eve sandbox with the working documentation repository at `/workspace/working-docs`      |
| Durable state       | Drizzle with local SQLite or a deployed libSQL-compatible database                      |
| Writeback           | Small checked diff, followed by an explicitly approved branch and draft PR              |
| Regression proof    | Live Eve evals covering patches, no-change decisions, signals, safety, and conversation |
