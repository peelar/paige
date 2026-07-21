# ADR-0005: Slack reaction ownership

Status: Accepted
Date: 2026-07-21

## Context

Slack users need immediate evidence that Paige accepted an explicit request,
but routine Eve reasoning and tool statuses make the channel feel noisy. Emoji
can also carry useful social meaning that depends on the conversation. Treating
all of these as one lifecycle-to-emoji mapping would either make acceptance
unreliable or make Paige's expression rigid.

## Decision

The Slack harness owns protocol feedback. It adds one deterministic working
reaction to accepted direct messages and explicit mentions, removes it when the
turn stops working, and suppresses routine reasoning and tool statuses. Passive
messages in followed threads do not receive this harness acknowledgement.

Paige may add one discretionary reaction to the message that started the
current Slack turn. A turn-scoped tool provides that capability without
exposing arbitrary Slack message identifiers. The harness and tool share the
same reaction validation, target, adapter, and add/remove operation.

Reactions never represent approval, rejection, success, failure, or another
authoritative workflow state. Eve replies and input cards continue to carry
those meanings.

## Consequences

- Immediate acceptance remains deterministic and does not depend on a model
  tool call.
- Paige can react naturally under light rules without a hardcoded semantic
  emoji matrix.
- A reaction API failure is logged but does not prevent accepted work from
  running or completed work from being delivered.
- Slack reaction behavior remains channel-specific while Eve session and
  approval contracts stay platform-independent.
