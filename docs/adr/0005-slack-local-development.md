# ADR-0005: Slack local development

Status: Open
Date: 2026-07-21

## Context

Slack behavior is currently tested against the production Paige deployment.
This exercises the real integration, but temporary Vercel deployments make
small runtime changes slow and annoying to verify.

## Decision

Choose a local development loop that sends real Slack events to a
developer-run Paige agent without requiring a temporary Vercel deployment. The
ingress method and ownership of the Slack connector are still open.

## Consequences

- Production testing remains the fallback until this decision is accepted.
- The chosen loop must preserve Slack signatures and real event payloads.
- Local and deployed agents must not process the same event accidentally.
- Setup should stay simple enough to use for short-lived behavior changes.
