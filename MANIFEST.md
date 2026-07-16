# Paige Manifest

## Mission

Paige is a documentation agent for software teams. It should understand product
signals, inspect the relevant evidence, and decide what documentation should
change—or whether nothing should change.

## Current Product

Paige currently responds only to direct messages in Slack. Chat SDK handles the
Slack transport and Eve runs the model conversation.

Paige can inspect configured read-only evidence repositories through a GitHub
API-backed evidence repository tool. Public and GitHub App-authorized access
are explicit repository settings. The configured documentation repository
and GitHub metadata surfaces have typed implementation shells, but are not
model-facing capabilities yet. There is no documentation workflow, product
database, or automated writeback.

## Stack

- Eve
- Chat SDK
- Vercel Connect
- Microsandbox
- Next.js and React
- Drizzle and libSQL
- pnpm and Turborepo
