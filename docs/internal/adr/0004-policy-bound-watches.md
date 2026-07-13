# ADR-0004: Use Policy-Bound Watches For Proactive Attention

Status: Accepted
Date: 2026-07-13
Supersedes: None

## Context

Paige can respond to explicit Slack mentions and Linear delegations, remain
present in an invited Slack thread, retrieve bounded Slack context on demand,
scan configured repositories, and revisit existing docs signals on a schedule.
Those entry points are intentionally scoped, but they do not let an operator
delegate ongoing attention to a provider resource such as a release or docs
feedback channel.

Implementing separate release-channel, docs-feedback, support, and initiative
workflows would couple each new goal to another provider-specific tool and
orchestration path. At the other extreme, arbitrary model-authored workflows,
raw prompt configuration, or executable recipes would make authority,
retention, privacy, and failure behavior difficult to enforce or audit.

The product needs a reusable primitive that leaves documentation judgment and
tool composition to the agent while keeping observation and action authority in
typed runtime policy.

## Decision

Paige will model proactive attention as a durable, declarative **watch**. A
watch is stored in the app-owned database behind shared typed services. It is
not an Eve session, Chat SDK subscription, docs signal, workspace memory,
schedule, or second workflow engine.

A watch defines:

- an explicitly approved workspace, provider, and resource;
- a bounded natural-language documentation goal;
- a trigger: `on_event` or `on_schedule`;
- an evaluation policy: `per_event` or `windowed`;
- a delivery policy: `immediate`, `digest`, or `silent`;
- admitted event types and bounded context;
- allowed Paige actions;
- retention and processing or delivery budgets;
- lifecycle, expiry, approval, and audit state.

The three timing dimensions remain independent. A Slack event may be evaluated
immediately but delivered later in a digest. A scheduled run may evaluate a
window even when no new event arrives. Digest describes delivery, not what
causes evaluation.

The natural-language goal may shape relevance judgment and capability
composition. It cannot expand provider scope, context access, allowed actions,
retention, budgets, repository mutation, delivery targets, or publishing
authority. Changes that expand those boundaries require fresh approval.

Provider adapters remain provider-specific at authentication, event admission,
and delivery boundaries. After rejecting unauthorized or unsupported events,
they normalize admitted context into a provider-neutral observation. Raw
observations are ephemeral by default. Persisting a docs signal is an explicit
escalation with provenance, not an automatic consequence of watching a source.

Each admitted event or scheduled occurrence starts or resumes a durable Eve
turn with the effective watch contract and bounded observation context. The
model may compose existing documentation capabilities only through actions
allowed by the watch and their existing tool policies. Repository writeback and
publishing remain separately approval gated.

Release-readiness review, docs-feedback triage, and future documentation goals
may be offered as examples or templates. They must use the same watch contract
and runtime rather than introduce privileged workflow types, purpose-specific
tools, or permanent identity instructions.

Missing watch state, storage, provider authorization, or policy validation must
fail visibly. The runtime must not widen admission, retain content, deliver a
message, or report an active watch through a fail-open fallback.

## Options Considered

- Purpose-specific workflows: make individual use cases explicit, but create a
  growing catalogue of tools and orchestration paths that limits agent
  composition and repeats provider behavior.
- Arbitrary executable recipes or raw prompts: maximize operator flexibility,
  but turn model-controlled text or code into an unsafe and difficult-to-audit
  authority boundary.
- Policy-bound watches: keep goals flexible while making observation, action,
  retention, delivery, and approval constraints structured and enforceable.

## Consequences

- New documentation-attention goals can usually be configured and evaluated
  without adding a new runtime workflow or tool.
- Provider adapters stay specific where provider authentication, permissions,
  events, and delivery semantics differ.
- The app-owned database needs watch, audit, idempotency, and bounded-window
  state separate from docs signals and Chat SDK conversations.
- Evals should prove outcomes and safety invariants across different watch
  configurations rather than require one exact tool sequence.
- Channel admission, raw-content lifetime, event volume, token use, duplicate
  delivery, and failure reporting become explicit product responsibilities.
- Existing mention, thread-presence, context-retrieval, signal, schedule, and
  publishing paths remain valid. Provider capture wrappers may be migrated
  incrementally after the generic watch path proves equivalent behavior.

## Links

- [Project manifest](../MANIFEST.md)
- [Project roadmap](../ROADMAP.md)
- [Repository model](../REPOSITORY_MODEL.md)
- [Workflow model](../WORKFLOWS.md)
- [ADR-0006: Use Stable Capability Families For Model Authority](./0006-stable-capability-families.md)
- [Capability contract and migration inventory](../CAPABILITIES.md)
- [Epic #57: Give Paige policy-bound watches for proactive docs attention](https://github.com/peelar/paige/issues/57)
- [Issue #58: Persist a bounded watch contract](https://github.com/peelar/paige/issues/58)
- [Issue #59: Admit configured Slack channel events](https://github.com/peelar/paige/issues/59)
- [Issue #60: Execute watch goals](https://github.com/peelar/paige/issues/60)
- [Issue #61: Configure and govern watches](https://github.com/peelar/paige/issues/61)
- [Issue #62: Prove release and docs-feedback scenarios](https://github.com/peelar/paige/issues/62)
