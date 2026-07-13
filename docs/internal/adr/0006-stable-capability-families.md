# ADR-0006: Use Stable Capability Families For Model Authority

Status: Accepted
Date: 2026-07-13
Supersedes: None

## Context

Paige currently exposes model-facing tools whose names reflect incremental
implementation slices, provider entry points, and scenario workflows. Policy-
bound watches need to store allowed actions before that surface is refactored.
Persisting current tool names or scenario verbs would make watch policy depend
on temporary orchestration and would encourage each new use case to add another
privileged workflow tool.

ADR-0004 establishes that a watch may guide model judgment but cannot expand
provider scope, retention, budgets, delivery, repository mutation, or
publication authority. The broader capability contract must now give that
policy stable identifiers without turning one identifier into a generic
execution surface.

## Decision

Paige will use these stable capability-family identifiers:

- `knowledge.read`: read bounded, provenance-bearing workspace evidence;
- `repository.read`: inspect configured repositories and run named read-oriented
  checks under repository policy;
- `docs_work.manage`: read and update durable documentation-work state;
- `draft.edit`: create and validate reversible changes in the configured
  working documentation repository sandbox;
- `follow_up.schedule`: manage bounded, signal-linked follow-up work;
- `provider.deliver`: deliver an allowed result to a preapproved provider
  target under provider policy, idempotency, and budgets;
- `publication.publish`: publish a prepared working-documentation draft through
  a dedicated approval-gated boundary.

These identifiers describe authority families, not tool names, workflow steps,
or promises that a capability is available. Runtime policy resolves the visible
tool set from the verified channel and principal, setup readiness, current work
state, and any effective approved watch revision. Every implementation must
recheck its own authorization and resource policy when it executes.

A watch may grant only a policy-approved subset of `knowledge.read`,
`repository.read`, `docs_work.manage`, `draft.edit`, `follow_up.schedule`, and
`provider.deliver`. It can never grant `publication.publish`. Publication
remains limited to a prepared draft in the configured working documentation
repository and requires explicit human approval on every call.

Documentation remains Paige's only mutable product domain. Durable docs-work
state and reversible sandbox drafts support that domain. Watched or source
repositories, provider conversations, workspace memories, and web results are
evidence or routing context, not mutable product targets. Provider delivery is
an external side effect separate from documentation publication.

Ignore and abstain are outcomes. They do not grant authority and are not
capability identifiers.

Workspace setup, workspace-memory governance, and provider admission remain
non-delegable control or adapter boundaries. They are inventoried alongside
model-facing tools but are not watch-grantable capability families.

## Options Considered

- Persist current tool names: simple initially, but couples durable policy to
  temporary wrappers and makes later consolidation a data migration. Rejected.
- Persist scenario verbs such as release review or feedback triage: easy to
  present, but creates purpose-specific workflow authority and limits model
  composition. Rejected.
- Persist stable resource-and-authority families: keeps policy durable while
  allowing tools, skills, and orchestration to evolve independently. Accepted.

## Consequences

- Watch schemas and effective revisions can validate allowed actions against a
  small stable vocabulary instead of the current tool catalogue.
- Tool consolidation may change model-facing names without changing stored
  authority when the resource and side-effect boundary stays the same.
- Dynamic tool visibility is defense in depth, not authorization by itself.
- Every current and planned surface needs a migration destination, consumer,
  state owner, proof surface, and removal condition.
- New capability-family identifiers require architecture review. New tools do
  not require a new identifier when they remain inside an accepted family.
- Provider delivery may be automated only inside an approved target and policy;
  it cannot mutate documentation or stand in for publication approval.

## Links

- [Architecture contract](../../ARCHITECTURE.md)
- [Capability contract and migration inventory](../CAPABILITIES.md)
- [ADR-0004: Use Policy-Bound Watches For Proactive Attention](./0004-policy-bound-watches.md)
- [Epic #57: Give Paige policy-bound watches for proactive docs attention](https://github.com/peelar/paige/issues/57)
- [Issue #63: Record Paige's capability contract and migration baseline](https://github.com/peelar/paige/issues/63)
