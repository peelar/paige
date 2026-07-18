# Agent repository configuration

## Context

Paige needs one documentation repository and optional evidence repositories
before repository work can begin. One database belongs to one Paige agent, and
the setup must be shared across every channel connected to that agent. Channel
identities must not choose or partition repository access. Corrections and
abandoned setup attempts must remain inside their conversation.
Accepting arbitrary repositories during later tool calls would weaken the
access boundary.

## Decision

Store one active repository configuration for the agent in libSQL. Keep the
draft proposal in Eve conversation state. Normalize GitHub
URLs, remove duplicates, validate access for each real repository, and require
explicit confirmation before activating the whole proposal. Resolve all later
repository IDs from the active configuration. Give the documentation
repository write-capable access and evidence repositories read-only access.

## Consequences

Every connected channel immediately shares confirmed setup. Corrections remain
private until confirmed. Concurrent changes use revision checks instead of
silent overwrites. Repository features require configured database storage but
do not require a Slack, Linear, Teams, or other channel identity.
