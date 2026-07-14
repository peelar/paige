# Capability Contract And Migration Inventory

Status: Accepted
Last Reviewed: 2026-07-14

This document maps Paige's current and planned execution surface to the stable
authority families accepted in ADR-0006. Capability identifiers are durable
policy terms. Tool names and workflow wrappers may change without changing
stored authority when their resource and side-effect boundary stays the same.

Run `pnpm capability:check` to compile the current Eve manifest and verify that
every authored and framework tool is represented here. Counts are derived from
`apps/agent/.eve/compile/compiled-agent-manifest.json`; they are not maintained
in this document.

All 26 current authored tools and framework overrides compile only as `dynamicTools` resolved on
`step.started`; the static authored `tools` manifest is empty. Their six
procedural skills compile only as `dynamicSkills` resolved on `turn.started`;
the static `skills` manifest is empty. The checked resolver matrix combines
channel and principal identity with current setup, provider, prepared-draft,
approval-resume, and exact watch-revision authority. Every dynamic executor is
inline for Eve replay serialization and rechecks authority before its effect.
Resolution and the exceptional approved-publication resume are projected to a
durable redacted event instead of relying on console output.

## Stable Capability Families

| Identifier | Resource and effect | Watch grant | Enforcement |
| --- | --- | --- | --- |
| `knowledge.read` | Read bounded, provenance-bearing workspace evidence. | Policy subset | Source scope, privacy, retention, and output bounds are checked at execution. |
| `repository.read` | Materialize, inspect, search, and run named read-oriented checks against configured repositories. | Policy subset | Repository identity, allowed actions, paths, refs, network, and setup readiness are checked at execution. |
| `docs_work.manage` | Create, read, and update durable internal working documents, documentation signals, plans, recommendations, milestones, blockers, artifacts, and outcomes. | Policy subset | The current agent database, workspace and resource scope, lifecycle, provenance, bounds, and concurrency rules are checked at execution. |
| `draft.edit` | Create, inspect, validate, or abandon reversible working-documentation changes in the sandbox. | Policy subset | Only the configured working documentation repository may change and publication is not included. |
| `follow_up.schedule` | Create, inspect, cancel, and claim bounded signal-linked follow-up work. | Policy subset | Due time, occurrence, item limits, lifecycle, and idempotency are checked at execution. |
| `provider.deliver` | Deliver an allowed result to one preapproved provider target. | Policy subset | Verified provider identity, target, delivery mode, budgets, idempotency, and effective policy are checked at execution. |
| `publication.publish` | Publish a prepared working-documentation draft through a dedicated external write boundary. | Never | The configured repository, prepared diff, checks, caller authorization, and explicit human approval are checked on every call. |

Ignore and abstain are outcomes, not capabilities. They grant no authority and
must not appear in an allowed-action set.

Workspace setup, workspace-memory governance, and provider admission remain
separate non-delegable control or adapter boundaries. They can determine
whether a capability is available but a watch cannot grant them.

## Current Authored Tool Migration

The compiled manifest is the source of truth for the authored surface. The
checker fails when a tool is added or removed without a complete row.

| Surface | Destination | Disposition | Authority | Consumer | Durable state | Proof | Removal condition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `authoring_workspace` | `draft.edit` | Keep as authority boundary | The sole reversible mutation and preparation path in the configured working-docs sandbox, with raw-byte content-hash or create-only preconditions and no-symlink traversal. | Localized, signal-backed, owned, correction, and multi-file authoring. | Stable draft identity and links, bounded structured operations, exact rollback snapshot, per-session/repository FIFO, checks, and prepared diff hash. | Atomic authoring, binary update, symlink escape, FIFO, signal-lifecycle, convergence-eval, and publication-identity tests. | Replace only with a surface preserving ordered virtual preflight, exact rollback, plan concurrency, idempotent abandonment, checks, and prepared-diff semantics. |
| `capture_linear_docs_signal` | Non-delegable provider admission then `docs_work.manage` | Keep as authority boundary | Verified Linear Agent Session context may create or dedupe one docs signal. | Linear channel intake. | Docs signal, sources, decisions, and lifecycle events. | Linear docs-signal eval and channel tests. | Remove only when the Linear adapter invokes the provider-neutral intake service without a model-facing wrapper. |
| `capture_slack_docs_signal` | Non-delegable provider admission then `docs_work.manage` | Keep as authority boundary | Verified Slack mention or DM context may create or dedupe one docs signal. | Slack mention and DM intake. | Docs signal, sources, decisions, and lifecycle events. | Slack docs-signal and participation evals plus channel tests. | Remove only when the Slack adapter invokes the provider-neutral intake service without a model-facing wrapper. |
| `configure_github_writeback` | Non-delegable workspace setup | Keep as authority boundary | A human setup flow may validate and persist scoped GitHub writeback configuration. | Setup conversation and operator onboarding. | Workspace setup and append-only setup events. | Setup-state and GitHub preflight tests. | Remove from the model surface when authenticated UI or CLI setup fully owns this mutation. |
| `configure_working_repository` | Non-delegable workspace setup | Keep as authority boundary | A human setup flow may validate and persist the one mutable documentation repository without materializing it. | Setup conversation and operator onboarding. | Workspace setup and append-only setup events. | Setup-state, onboarding, and repository-policy tests. | Remove from the model surface when authenticated UI or CLI setup fully owns this mutation. |
| `docs_follow_up` | `follow_up.schedule` | Keep as authority boundary | Manage only the bounded follow-up checklist on existing docs signals. | Interactive maintainers and docs-work flows. | Follow-up rows and visible schedule-run state. | Follow-up service and schedule tests. | Replace only with the canonical follow-up resource surface preserving lifecycle and bounds. |
| `docs_work_manage` | `docs_work.manage` | Keep as canonical mutation capability | Create or dedupe manual documentation work, apply bounded triage, run repository-corroborated verification, record typed editorial decisions and plans, link evidence, and update the original substantial-work lifecycle. It accepts no workspace, actor, status, or transition authority. | Interactive, provider-follow-up, schedule, and future watch turns after provider admission. | Docs signal, server-owned lifecycle events, evidence links, artifacts, session decision and plan revisions, and one substantial owned-work projection. | Input-boundary, actor, idempotency, optimistic-concurrency, replay, cross-resource, existing service, compiled-manifest, and live docs-work eval proof. | Replace only with an equivalent mutation surface preserving server-owned scope, typed transitions, repository-corroborated verification, resource identity, revisions, idempotency, and distinct draft/follow-up/document/publication boundaries. |
| `docs_work_read` | `docs_work.manage` | Keep as canonical read capability | Find bounded documentation work, inspect one aggregate with provenance and lifecycle, or inspect the current session's typed editorial decision and plan without mutation. Model output omits source text, internal operation keys, and credential-shaped metadata. | Interactive, provider, schedule, and future watch turns. | Read-only projection of docs signals, owned work, events, artifacts, and Eve session decision state. | Bounded projection, redaction, source-text omission, aggregate read, compiled-manifest, and live docs-work eval proof. | Replace only with an equivalent bounded read surface preserving workspace scope, provenance, aggregate identity, and redacted model output. |
| `get_docs_profile` | `repository.read` | Keep as derived profile projection | Read or refresh conventions through the canonical working-repository policy service. | Authoring and editorial planning. | Repository profile and bounded page evidence. | Docs-profile policy tests and authoring evals. | Remove only when another projection preserves cached convention inference separately from raw repository inspection. |
| `get_setup_status` | Non-delegable workspace setup | Keep as dynamic readiness surface | Readiness may narrow visible capabilities but cannot grant authority. | Dynamic instructions, setup conversation, and preflight. | Workspace setup and connector readiness projections. | Setup-state, readiness, dynamic resolver matrix, and status smoke tests. | Remove from the model surface when readiness is injected dynamically and explicit setup inspection has another bounded surface. |
| `internal_document` | `docs_work.manage` | Keep as resource primitive | Create, read, revise, attach, find, and archive bounded Paige-owned working documents without accepting caller-selected workspace, actor, or runtime provenance. | Interactive and future watch or documentation-work skills. | Internal document tombstone, bounded full-snapshot revisions, typed attachments, and server-owned provenance. | Internal-document service tests, migration parity, capability inventory, and living-summary/chronological-log evals. | Replace only with an equivalent general document surface preserving lifecycle, retention, attachment authority, idempotency, optimistic concurrency, and provenance. |
| `memory_get` | Non-delegable workspace-memory governance | Keep as authority boundary | Read routing context with complete provenance and lifecycle. | Interactive triage and dynamic memory context. | Workspace-memory rows, sources, and events. | Workspace-memory lifecycle and trust-boundary evals. | Replace only with a governed memory surface preserving provenance and trust semantics. |
| `memory_mark_stale` | Non-delegable workspace-memory governance | Keep as authority boundary | Mark memory unusable pending review without editing its content. | Maintainer and evidence-review flows. | Workspace-memory lifecycle event. | Workspace-memory lifecycle eval and service tests. | Replace only with a governed memory surface preserving audited lifecycle transitions. |
| `memory_promote` | Non-delegable workspace-memory governance | Keep as authority boundary | Explicitly approve proposed routing context for later use. | Maintainer and confirmed workflow flows. | Workspace-memory lifecycle event. | Workspace-memory lifecycle and trust-boundary evals. | Replace only with a governed memory surface preserving explicit promotion. |
| `memory_propose` | Non-delegable workspace-memory governance | Keep as authority boundary | Create proposed routing context only and never public evidence. | Provider intake and interactive triage. | Proposed memory, provenance sources, and events. | Workspace-memory lifecycle and prompt-injection evals. | Replace only with a governed memory surface preserving proposal-only creation. |
| `memory_retire` | Non-delegable workspace-memory governance | Keep as authority boundary | Retire routing context without rewriting history. | Maintainer and evidence-review flows. | Workspace-memory lifecycle event. | Workspace-memory lifecycle eval and service tests. | Replace only with a governed memory surface preserving audited retirement. |
| `memory_search` | Non-delegable workspace-memory governance | Keep as authority boundary | Search active routing context that cannot prove a public claim. | Interactive triage and dynamic memory context. | Workspace-memory index and provenance. | Workspace-memory lifecycle and trust-boundary evals. | Replace only with a governed memory surface preserving source and trust labels. |
| `process_due_docs_followups` | `follow_up.schedule` | Keep as authority boundary | Claim one bounded UTC occurrence idempotently and never publish. | Daily schedule principal. | Follow-up claim and product-run records. | Follow-up, schedule, and run-index tests. | Replace only with the canonical schedule-processing surface preserving occurrence idempotency and limits. |
| `provider_delivery` | `provider.deliver` | Keep as source-bound watch delivery boundary | Queue one bounded result for the exact approved provider workspace and source resource; the caller supplies content but no target, mode, budget, or idempotency authority. | Policy-bound watch turns only. | Daily delivery budget, durable immediate or digest delivery row, stable provider idempotency key, bounded leases, and terminal redaction. | Capability matrix, destination, mode, budget, digest membership, retry-race, and provider adapter tests. | Replace only with an equivalent provider-neutral delivery boundary preserving exact source scope, server-owned targeting, budgets, stable idempotency, and retry semantics. |
| `publish_working_repository_pr` | `publication.publish` | Keep as authority boundary | Publish only the exact checked prepared draft identity and diff after approval; derive any signal from that draft. | Human-approved interactive resume. | Prepared draft and check snapshot, approval event, GitHub PR metadata, audit event, signal lifecycle, and the shared repository-workflow FIFO. | Approval integration, base/check/diff identity and publication-race tests, owned-work approval eval, and browser approval tests. | Replace only through a superseding architecture decision preserving explicit per-call approval, prepared-draft identity, repository scope, and serialization with authoring. |
| `retrieve_slack_context` | Non-delegable provider context read | Keep as authority boundary | Search once with the current Slack user's request-scoped token and retain only derived context. | Active user-triggered Slack turns. | No raw durable result; only derived response and permalinks in the turn. | Slack retrieval tests and privacy assertions. | Replace only with a provider-specific surface preserving current-user authorization and ephemeral reduction. |
| `scan_watched_repositories` | `knowledge.read` and `repository.read` | Merge into resource capability | Read configured watched repositories and compare them with working docs without source mutation. | Release scanning and future watch goals. | Release cursor, provenance-bearing findings, and docs signals when escalated. | Watched-repository tests and read-only eval. | Remove after source registry reads plus a scan skill reproduce the behavior without a workflow-shaped tool. |
| `web_fetch` | `knowledge.read` | Override framework visibility, preserve executor | Keep Eve's bounded framework fetch unchanged for ordinary contexts; a watch step sees it only after exact claim and `knowledge.read` authority resolve, and its executor rechecks that authority. | Ordinary answers and authorized watch evidence reads. | Eve turn evidence only. | Capability resolver failure/denial tests, compiled override inspection, and replay transform. | Remove only when Eve supports family-aware built-in tool visibility and execution checks directly. |
| `web_search` | `knowledge.read` | Override framework visibility, preserve provider executor | Keep Eve's provider-managed search unchanged for ordinary contexts; a watch step sees its provider descriptor only after exact claim and `knowledge.read` authority resolve. | Ordinary current-information answers and authorized watch evidence reads. | Provider result in Eve turn evidence only. | Capability resolver failure/denial tests and compiled provider-descriptor inspection. | Remove only when Eve supports family-aware provider-tool visibility directly. |
| `working_repository` | `repository.read` | Keep as canonical resource capability | Implicitly materialize and inspect only the configured working documentation repository through bounded list, search, text or binary-metadata hash-bearing read, status, diff, validator discovery, and named validation modes. | Direct, signal-backed, and future watch repository investigation. | Sandbox checkout, resolved repository identity, action provenance, shared repository-workflow FIFO, and the last disclosed typed validator profile. | Path, pattern, symlink, action, output-bound, full-file text/binary hash, validator, FIFO, compiled-manifest, and live discovery proof. | Replace only with an equivalent surface preserving repository identity, policy, provenance, validator ownership, source binding, and bounded outputs. |
| `workspace_knowledge` | `knowledge.read` and `repository.read` | Keep as canonical source capability | List configured workspace sources, search one or more configured repositories, and read bounded source files while preserving source identity, revision, path, evidence class, redaction, and untrusted-data handling. Watched and context repositories expose no mutation actions. | Load-on-demand workspace-grounded answers and later source-composing skills or watch turns. | Workspace-scoped setup registry, sandbox checkouts, resolved revisions, and bounded Eve turn evidence only; source contents are not copied into product persistence. | Source-kind/access policy, context setup, cross-source conflict, prompt-injection, redaction, unavailable-source, materialization, manifest, current-docs, answer-only, no-mutation, and explicit-continuation eval proof. | Replace only with an equivalent source registry preserving stable identity, evidence classes, provider/auth readiness, read-only enforcement, freshness, retention, and output bounds. |

## Removed Authored Tool Surfaces

| Surface | Removed in | Replacement | Proof |
| --- | --- | --- | --- |
| `run_docs_maintenance_scenario` | #79 | Eval scenarios compose the existing repository, recommendation, and authoring capabilities; historical keyword fixtures live only under deterministic test support. | Compiled-manifest inventory check, repository search, deterministic fixture tests, and docs-needed/no-change live evals. |
| `prepare_configured_working_repository` | #80 | `working_repository` materializes configured setup implicitly on its first operation. | Compiled-manifest assertion, setup/materialization tests, and live repository discovery eval. |
| `prepare_working_repository` | #80 | Setup persists repository identity separately; `working_repository` owns implicit materialization and bounded inspection. | Compiled-manifest assertion, setup/materialization tests, and live repository discovery eval. |
| `repo_export_diff` | #80 | `working_repository` diff mode inspects a bounded current draft; `authoring_workspace` retains draft preparation. | Compiled-manifest assertion, policy tests, and composable user-test evals. |
| `repo_read_file` | #80 | `working_repository` read mode enforces safe line-range reads and output bounds. | Compiled-manifest assertion, path and symlink tests, and live repository discovery eval. |
| `repo_run_checks` | #80 | `working_repository` discovers trusted named validators and runs only previously disclosed ids. | Compiled-manifest assertion plus validator ownership, stale-source, failure, and output-bound tests. |
| `repo_search` | #80 | `working_repository` search mode provides bounded literal or regular-expression search. | Compiled-manifest assertion, pattern and regex policy tests, and live repository discovery eval. |
| `prepare_docs_signal_patch` | #81 | Signal-backed drafts link the verified signal and derive lifecycle artifacts when the canonical `authoring_workspace` prepares checks and the exact diff. | Compiled-manifest assertion, signal-lifecycle tests, and focused-patch eval. |
| `repo_replace_text` | #81 | Full-file authoring operations use current content hashes or create-only intent inside an atomic bounded batch. | Compiled-manifest assertion plus stale-hash, rollback, retry, and convergence eval proof. |
| `content_plan` | #84 | `docs_work_manage` records or revises a typed substantial-work plan; `docs_work_read` inspects it. | Compiled-manifest assertion, content-plan tests, editorial evals, and docs-work evals. |
| `create_docs_signal` | #84 | Provider adapters keep their admitted capture boundaries; explicit manual work uses the idempotent `docs_work_manage` create operation. | Compiled-manifest assertion, provider-intake tests, create replay tests, and continuation eval. |
| `editorial_recommendation` | #84 | `docs_work_manage` records or revises a typed editorial decision with optimistic revision checks. | Compiled-manifest assertion, editorial tests, and intervention evals. |
| `get_docs_signal` | #84 | `docs_work_read` inspects the bounded aggregate and projects source presence without source text. | Compiled-manifest assertion, projection tests, and docs-work evals. |
| `list_docs_signals` | #84 | `docs_work_read` finds bounded documentation work by lifecycle and source. | Compiled-manifest assertion, queue tests, and docs-work evals. |
| `owned_docs_work` | #84 | `docs_work_manage` starts and updates the original substantial work through typed milestone, correction, park or manual-pause, resume, and complete, blocked, abandoned, or failed finish operations. | Compiled-manifest assertion, owned-work concurrency tests, and docs-work evals. |
| `update_docs_signal_lifecycle` | #84 | `docs_work_manage` exposes only bounded triage outcomes; the server selects actor, status mapping, and transition authority. | Compiled-manifest assertion, lifecycle authority tests, and docs-work input-boundary tests. |
| `verify_docs_signal_current_docs` | #84 | `docs_work_manage` keeps the internal verification service behind `verify_current_docs`, so only runtime repository reads can record `docs-verified`. | Compiled-manifest assertion, verification tests, authoring integration, and docs-work evals. |

## Framework Tool Inventory

The checker derives this list from the installed Eve default-harness guide and
uses the compiled manifest to verify disabled tools. Availability marked
conditional is resolved by Eve per session and is not an authority grant.

| Surface | Current status | Destination | Authority | Durable state | Proof | Removal condition |
| --- | --- | --- | --- | --- | --- | --- |
| `bash` | Disabled | None | Raw shell remains unavailable to the model. | None. | Compiled manifest disabled-tool assertion. | Must remain disabled unless a superseding architecture decision replaces the policy-aware repository boundary. |
| `read_file` | Disabled | None | Unrestricted sandbox file reads remain unavailable to the model. | None. | Compiled manifest disabled-tool assertion. | Must remain disabled while repository reads require policy and provenance. |
| `write_file` | Disabled | None | Unrestricted sandbox writes remain unavailable to the model. | None. | Compiled manifest disabled-tool assertion. | Must remain disabled while `draft.edit` is the only model-driven mutation path. |
| `glob` | Disabled | None | Unrestricted sandbox discovery remains unavailable to the model. | None. | Compiled manifest disabled-tool assertion. | Must remain disabled while repository reads require policy and bounds. |
| `grep` | Disabled | None | Unrestricted sandbox search remains unavailable to the model. | None. | Compiled manifest disabled-tool assertion. | Must remain disabled while repository reads require policy and bounds. |
| `web_fetch` | Active; exact-grant gated for watches | `knowledge.read` | Read a named public URL with bounded model output and no Paige mutation. Dynamic override preserves ordinary behavior and hides or rejects it for watches without exact `knowledge.read` authority. | Eve turn events only. | Eve framework discovery, capability resolver tests, compiled override inspection, and conversation evals. | Remove the override only when Eve supports family-aware built-in visibility and execution checks directly. |
| `web_search` | Provider conditional; exact-grant gated for watches | `knowledge.read` | Search through the selected model provider without granting external mutation. Dynamic override preserves ordinary behavior and exposes the provider descriptor to a watch only with exact `knowledge.read` authority. | Provider response in Eve turn events. | Eve framework discovery, capability resolver tests, compiled provider-descriptor inspection, and conversation evals. | Remove the override only when Eve supports family-aware provider-tool visibility directly. |
| `todo` | Active | Framework planning support | Maintain model planning state without creating Paige product state. | Eve framework todo state. | Eve framework discovery and runtime tests. | Keep framework-owned unless Paige needs a product-visible work resource. |
| `ask_question` | Session conditional | Human interaction boundary | Park for clarification only when the channel can request input. | Eve pending input request and session stream. | Eve HITL tests and owned-work evals. | Keep framework-owned while channels use Eve's durable input protocol. |
| `agent` | Root only | Framework delegation support | Delegate bounded work but do not treat delegation as authorization. | Eve child session and stream. | Eve framework discovery and runtime tests. | Disable if delegation cannot be constrained by the current capability resolver. |
| `load_skill` | Active | Workflow guidance | Load procedures only and add no executable authority. | Active turn context. | Eve framework discovery and skill-routing evals. | Keep while Paige exposes load-on-demand skills. |
| `connection_search` | Unavailable without connections | Non-delegable connection discovery | Discover connection tools only after an authored connection exists and its own authorization applies. | Eve step context and connection auth state. | Eve framework discovery and zero-connection manifest assertion. | Inventory again before adding any authored connection. |

## Planned Watch Surface Migration

| Surface | Destination | Consumer | Durable state | Proof | Removal condition |
| --- | --- | --- | --- | --- | --- |
| #58 and #64-#69 watch contract | Typed policy and lifecycle input to capability resolution, not a model-facing capability. | Provider admission, watch execution, and operator governance. | Proposed watches, immutable effective revisions, audit events, lifecycle, expiry, and readiness. | Control-plane policy, persistence, concurrency, and fail-closed tests. | Permanent runtime boundary; trackers close when child slices ship. |
| #59 and #70-#75 provider observation admission | Non-delegable provider adapter that may supply bounded observations to `knowledge.read`. | Slack event adapter and later watch execution. | Ephemeral raw observations plus minimal dedupe claims and bounded windows. | Admission, subtype rejection, privacy, dedupe, restart, window, and budget tests. | Provider-specific adapter remains; purpose-specific workflow wrappers must not be added. |
| #60 watch goal execution | Dynamic composition of the approved subset of `knowledge.read`, `repository.read`, `docs_work.manage`, `draft.edit`, `follow_up.schedule`, and `provider.deliver`, with watch procedure supplied by a skill. | Eve watch turns. | Eve session and run, exact effective watch revision reference, redacted action outcomes, and durable source-bound provider delivery state. | Capability-matrix, skill-routing, execution, budget, delivery-mode, retry-race, and failure tests. | No permanent compatibility wrapper or watch-journal tool; execution must converge on canonical capabilities from CR2-CR7. |
| #77 watch continuity | The general `internal_document` resource inside `docs_work.manage`, with watch-specific editing procedure supplied only by the dynamic skill. | Eve watch turns whose exact revision grants `docs_work.manage`. | One living-summary attachment per stable watch identity, bounded immutable revisions, and server-owned watch, occurrence, effective-revision, session, and run provenance. | Cross-session and effective-revision identity tests, concurrent-edit proof, tool resource-scope tests, skill-routing assertions, and the read/update/revise/no-op watch eval. | Keep the generic document primitive and typed watch attachment; do not add a watch journal tool or retain raw provider observations. |
| #61 watch configuration and governance | Non-delegable operator control plane over typed watch services. | Authenticated operator app and setup flows. | Proposed and effective watches, previews, approvals, lifecycle, and audit history. | Service, authorization, browser, reapproval, and fail-closed tests. | Permanent governance boundary aligned with CR9; no raw prompt or generic tool editor. |
| #62 release and docs-feedback proof | Eval fixtures and templates using one watch runtime. | Behavioral regression suite and product examples. | Eval artifacts and bounded fixture configuration only. | Cross-scenario behavior, policy, delivery, and no-purpose-specific-tool assertions. | Fixtures remain while useful; they never become production tool names or authority values. |

## Behavioral Proof Boundary

`pnpm --filter docs-agent eval --list` currently discovers 52 cases across the
conversation, documentation, provider, watched-repository, memory, authoring,
and approval surfaces.

<!-- CAPABILITY_BASELINE_START -->
#79 ran the four composable working-repository cases live under Node 24.18.0:
the historical docs-needed case passed 19/19 gates, the historical no-change
case passed 20/20, the source-backed EditorJS case passed 19/19, and the
repository-generic pagination no-change case passed 20/20. The evals assert
semantic outcomes, repository and changed-file authority, checks, empty or
focused diffs, and the no-publication boundary without prescribing one exact
tool sequence. #32 and #37 retain their separate live and external proof
requirements.
<!-- CAPABILITY_BASELINE_END -->

The `workspace-knowledge-sources` cross-source case plus the six
`workspace-knowledge-answers` cases cover current-docs answers, cross-source
answers, contradictory provider and memory context, missing setup, tool-free
ordinary conversation, gap recommendation without mutation, and an explicit
multi-turn continuation into one provenance-bearing docs signal. They assert
semantic outcomes, inspected sources, freshness, uncertainty, and absence of
durable side effects rather than one exact read order. The definitions are
committed but remain unexecuted while the inherited Eve microsandbox
session-start blocker from #81 and #82 is unchanged.

The deterministic and local live suites do not replace external proof:

- #32 remains open until its required before-and-after live behavior comparison
  is recorded without weakening assertions.
- #37 remains open until production-like GitHub OAuth and deployment behavior
  is proved with a real operator account.

Those blockers are intentionally outside #63 and must not be closed by this
inventory.
