# ADR-0006: Use Stable Capability Families And Composable Resource Primitives

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

The intended agent architecture is the opposite: Paige should receive a small
set of general, policy-aware primitives and compose them according to the goal
and context. A release review, feedback triage, or watch occurrence may need a
different procedure, but that procedure should not become a new privileged tool
when the same work can be expressed with existing resources and authority.

ADR-0004 establishes that a watch may guide model judgment but cannot expand
provider scope, retention, budgets, delivery, repository mutation, or
publication authority. The broader capability contract must now give that
policy stable identifiers without turning one identifier into a generic
execution surface.

## Decision

Paige will separate model authority, resource operations, and workflow guidance:

1. Capability families are the stable authority vocabulary stored in policy.
2. Model-facing tools perform general operations on typed, policy-scoped
   resources inside those families.
3. Skills provide goal- or workflow-specific procedures for composing those
   tools. A skill may narrow behavior, but it does not add authority.

Paige will use these stable capability-family identifiers:

- `knowledge.read`: read bounded, provenance-bearing workspace evidence;
- `repository.read`: inspect configured repositories and run named read-oriented
  checks under repository policy;
- `docs_work.manage`: create, read, and update durable, workspace-scoped agent
  working documents and other documentation-work state;
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

Tools inside a family should be useful across workflows. They may expose typed
operations for a resource, but they must not encode a scenario merely to make
the scenario easier to orchestrate. Procedures such as how to investigate a
release, maintain a watch journal, or revise a content plan belong in skills
that compose those tools. Different skills may provide different editing
procedures for the same underlying resource primitive.

A watch may grant only a policy-approved subset of `knowledge.read`,
`repository.read`, `docs_work.manage`, `draft.edit`, `follow_up.schedule`, and
`provider.deliver`. It can never grant `publication.publish`. Publication
remains limited to a prepared draft in the configured working documentation
repository and requires explicit human approval on every call.

Documentation remains Paige's only mutable product domain. This includes
internal agent working documents that support documentation work, as well as
structured state such as signals, plans, recommendations, and outcomes. These
are explicit, inspectable Paige-owned resources rather than public documentation
or hidden conversation memory. Reversible sandbox drafts are the separate
mutation surface for proposed changes to the configured working documentation
repository.

An internal agent working document is a general primitive. The agent may create
one for itself, update it across sessions, and attach it to another Paige-owned
resource through a typed relationship. The primitive owns common mechanics such
as workspace scope, lifecycle, provenance, bounds, and concurrency. The
owning resource defines when the document should exist and how it is attached.
The applicable skill defines what it should contain and whether the agent should
append, revise, summarize, or leave it unchanged. The storage format and user
editing interface are implementation details, not capability families.

ADR-0004 applies this pattern to watch continuity: one internal working document
is linked to each watch, and a watch execution skill defines how Paige maintains
it. The runtime supplies only the generic document operations authorized by
`docs_work.manage`; it does not expose a `write_watch_journal` capability or
tool. Another workflow may use the same primitive with a different skill and
editing experience.

Watched or source repositories, provider conversations, workspace memories,
and web results remain evidence or routing context, not mutable product targets.
Internal working documents may summarize or reference that context under their
own retention and provenance policy, but they do not turn the source into a
mutable target or trusted public evidence. Provider delivery is an external
side effect separate from documentation publication.

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
- Add purpose-specific tools for durable artifacts such as watch journals: makes
  each workflow convenient in isolation, but duplicates storage and editing
  behavior and moves procedure into the execution surface. Rejected.
- Persist stable resource-and-authority families: keeps policy durable while
  allowing tools, skills, and orchestration to evolve independently. Accepted.
- Use general resource primitives with workflow-specific skills: preserves one
  governed implementation for common operations while allowing the agent's
  editing procedure to vary by purpose. Accepted.

## Consequences

- Watch schemas and effective revisions can validate allowed actions against a
  small stable vocabulary instead of the current tool catalogue.
- Tool consolidation may change model-facing names without changing stored
  authority when the resource and side-effect boundary stays the same.
- Internal working documents can support continuity across Eve sessions without
  reusing hidden conversation history as product memory.
- A new workflow or document-editing experience should normally add or revise a
  skill, not add a capability family or purpose-specific privileged tool.
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
