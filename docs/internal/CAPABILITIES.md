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
| `authoring_workspace` | `draft.edit` | Keep as authority boundary | Reversible mutation only in the configured working-docs sandbox. | Interactive and signal-backed authoring. | Sandbox draft plus authoring workflow state and prepared diff metadata. | Authoring tests, owned-work evals, and approval eval. | Replace only with a surface preserving batched edits, concurrency, checks, abandonment, and prepared-diff semantics. |
| `capture_linear_docs_signal` | Non-delegable provider admission then `docs_work.manage` | Keep as authority boundary | Verified Linear Agent Session context may create or dedupe one docs signal. | Linear channel intake. | Docs signal, sources, decisions, and lifecycle events. | Linear docs-signal eval and channel tests. | Remove only when the Linear adapter invokes the provider-neutral intake service without a model-facing wrapper. |
| `capture_slack_docs_signal` | Non-delegable provider admission then `docs_work.manage` | Keep as authority boundary | Verified Slack mention or DM context may create or dedupe one docs signal. | Slack mention and DM intake. | Docs signal, sources, decisions, and lifecycle events. | Slack docs-signal and participation evals plus channel tests. | Remove only when the Slack adapter invokes the provider-neutral intake service without a model-facing wrapper. |
| `configure_github_writeback` | Non-delegable workspace setup | Keep as authority boundary | A human setup flow may validate and persist scoped GitHub writeback configuration. | Setup conversation and operator onboarding. | Workspace setup and append-only setup events. | Setup-state and GitHub preflight tests. | Remove from the model surface when authenticated UI or CLI setup fully owns this mutation. |
| `configure_working_repository` | Non-delegable workspace setup | Keep as authority boundary | A human setup flow may validate and persist the one mutable documentation repository. | Setup conversation and operator onboarding. | Workspace setup and append-only setup events. | Setup-state, onboarding, and repository-policy tests. | Remove from the model surface when authenticated UI or CLI setup fully owns this mutation. |
| `content_plan` | `docs_work.manage` | Merge into resource capability | Documentation planning state only and no repository mutation. | Substantial docs work. | Content plan linked to the originating docs signal and draft. | Content-plan tests, editorial evals, and owned-work evals. | Remove after the durable docs-work capability exposes equivalent plan operations. |
| `create_docs_signal` | `docs_work.manage` | Merge into resource capability | Create or dedupe one provenance-bearing documentation work item. | Provider intake, scans, schedules, and manual context. | Docs signal, sources, decisions, and lifecycle events. | Signal-service tests and docs-signal evals. | Remove after provider adapters and the durable docs-work capability own signal creation. |
| `docs_follow_up` | `follow_up.schedule` | Keep as authority boundary | Manage only the bounded follow-up checklist on existing docs signals. | Interactive maintainers and docs-work flows. | Follow-up rows and visible schedule-run state. | Follow-up service and schedule tests. | Replace only with the canonical follow-up resource surface preserving lifecycle and bounds. |
| `editorial_recommendation` | `docs_work.manage` | Merge into resource capability | Record documentation judgment without granting draft or publication authority. | Verified docs work. | Recommendation linked to evidence, plan, and draft. | Editorial tests and intervention evals. | Remove after the durable docs-work capability exposes equivalent recommendation operations. |
| `get_docs_profile` | `repository.read` | Merge into resource capability | Read or refresh conventions from the configured working documentation repository. | Authoring and editorial planning. | Repository profile and bounded page evidence. | Docs-profile tests and authoring evals. | Remove after the working-repository capability returns profile and convention reads. |
| `get_docs_signal` | `docs_work.manage` | Merge into resource capability | Read one documentation work item and its provenance. | Interactive, provider, schedule, and watch turns. | Docs signal, sources, links, artifacts, and events. | Signal-service tests and docs-work evals. | Remove after the durable docs-work capability exposes equivalent get operations. |
| `get_setup_status` | Non-delegable workspace setup | Make dynamic | Readiness may narrow visible capabilities but cannot grant authority. | Dynamic instructions, setup conversation, and preflight. | Workspace setup and connector readiness projections. | Setup-state, readiness, and status smoke tests. | Remove from the model surface when readiness is injected dynamically and explicit setup inspection has another bounded surface. |
| `list_docs_signals` | `docs_work.manage` | Merge into resource capability | List bounded documentation work by lifecycle and source. | Interactive, schedule, and watch turns. | Docs-signal index in the agent database. | Signal-service tests and docs-work evals. | Remove after the durable docs-work capability exposes equivalent list operations. |
| `memory_get` | Non-delegable workspace-memory governance | Keep as authority boundary | Read routing context with complete provenance and lifecycle. | Interactive triage and dynamic memory context. | Workspace-memory rows, sources, and events. | Workspace-memory lifecycle and trust-boundary evals. | Replace only with a governed memory surface preserving provenance and trust semantics. |
| `memory_mark_stale` | Non-delegable workspace-memory governance | Keep as authority boundary | Mark memory unusable pending review without editing its content. | Maintainer and evidence-review flows. | Workspace-memory lifecycle event. | Workspace-memory lifecycle eval and service tests. | Replace only with a governed memory surface preserving audited lifecycle transitions. |
| `memory_promote` | Non-delegable workspace-memory governance | Keep as authority boundary | Explicitly approve proposed routing context for later use. | Maintainer and confirmed workflow flows. | Workspace-memory lifecycle event. | Workspace-memory lifecycle and trust-boundary evals. | Replace only with a governed memory surface preserving explicit promotion. |
| `memory_propose` | Non-delegable workspace-memory governance | Keep as authority boundary | Create proposed routing context only and never public evidence. | Provider intake and interactive triage. | Proposed memory, provenance sources, and events. | Workspace-memory lifecycle and prompt-injection evals. | Replace only with a governed memory surface preserving proposal-only creation. |
| `memory_retire` | Non-delegable workspace-memory governance | Keep as authority boundary | Retire routing context without rewriting history. | Maintainer and evidence-review flows. | Workspace-memory lifecycle event. | Workspace-memory lifecycle eval and service tests. | Replace only with a governed memory surface preserving audited retirement. |
| `memory_search` | Non-delegable workspace-memory governance | Keep as authority boundary | Search active routing context that cannot prove a public claim. | Interactive triage and dynamic memory context. | Workspace-memory index and provenance. | Workspace-memory lifecycle and trust-boundary evals. | Replace only with a governed memory surface preserving source and trust labels. |
| `owned_docs_work` | `docs_work.manage` | Merge into resource capability | Manage one substantial task on its originating signal and Eve session. | Substantial interactive and provider-originated docs work. | Owned-work projection, milestones, blockers, artifacts, and outcomes. | Owned-docs-work tests and evals. | Remove after the durable docs-work capability exposes equivalent ownership and continuation operations. |
| `prepare_configured_working_repository` | `repository.read` | Merge into resource capability | Materialize only the persisted working documentation repository under policy. | Any configured repository investigation. | Sandbox checkout plus resolved setup metadata. | Repository-materialization and setup tests. | Remove after the working-repository capability owns materialization. |
| `prepare_docs_signal_patch` | `draft.edit` and `docs_work.manage` | Merge into resource capability | Prepare a reversible draft and record its signal outcome without publishing. | Existing signal patch handoff. | Sandbox draft, checks, diff, artifacts, and signal lifecycle. | Patch-workflow tests, user-test evals, and approval eval. | Remove after authoring and durable docs-work capabilities cover the same composition. |
| `prepare_working_repository` | `repository.read` | Merge into resource capability | Materialize one explicitly supplied working repository under repository policy. | Manual scenarios and setup-time preparation. | Sandbox checkout and resolved repository metadata. | Repository-materialization and policy tests. | Remove after setup persists configuration and the working-repository capability owns materialization. |
| `process_due_docs_followups` | `follow_up.schedule` | Keep as authority boundary | Claim one bounded UTC occurrence idempotently and never publish. | Daily schedule principal. | Follow-up claim and product-run records. | Follow-up, schedule, and run-index tests. | Replace only with the canonical schedule-processing surface preserving occurrence idempotency and limits. |
| `publish_working_repository_pr` | `publication.publish` | Keep as authority boundary | Publish only a checked prepared diff to the configured working docs repository after approval. | Human-approved interactive resume. | Prepared workflow result, approval event, GitHub PR metadata, audit event, and signal lifecycle. | Approval integration, writeback tests, owned-work approval eval, and browser approval tests. | Replace only through a superseding architecture decision preserving explicit per-call approval and repository scope. |
| `repo_export_diff` | `draft.edit` | Merge into resource capability | Inspect the current reversible draft diff without external write. | Authoring and legacy scenario workflows. | Sandbox working tree and prepared diff metadata. | Repository-runner and authoring tests. | Remove after `authoring_workspace` owns all diff inspection and export consumers. |
| `repo_read_file` | `repository.read` | Merge into resource capability | Read a bounded file from the configured working documentation repository. | Legacy scenario and verification workflows. | Sandbox checkout only. | Repository-runner and policy tests. | Remove after the working-repository capability exposes bounded reads. |
| `repo_replace_text` | `draft.edit` | Merge into resource capability | Apply an exact reversible replacement in the working-docs sandbox. | Legacy scenario and patch workflows. | Sandbox working tree. | Repository-runner and authoring tests. | Remove after all consumers use `authoring_workspace` batched mutations. |
| `repo_run_checks` | `repository.read` | Merge into resource capability | Run allowlisted named checks without granting arbitrary shell access. | Verification, authoring, and legacy scenario workflows. | Check results linked to the sandbox revision. | Repository-runner, policy, and authoring tests. | Remove after the working-repository capability owns named checks. |
| `repo_search` | `repository.read` | Merge into resource capability | Search bounded paths in a configured repository. | Verification and legacy scenario workflows. | Sandbox checkout only. | Repository-runner and policy tests. | Remove after the working-repository capability exposes bounded search. |
| `retrieve_slack_context` | Non-delegable provider context read | Keep as authority boundary | Search once with the current Slack user's request-scoped token and retain only derived context. | Active user-triggered Slack turns. | No raw durable result; only derived response and permalinks in the turn. | Slack retrieval tests and privacy assertions. | Replace only with a provider-specific surface preserving current-user authorization and ephemeral reduction. |
| `run_docs_maintenance_scenario` | Eval-only workflow support | Move to eval-only support | Execute a fixture-oriented end-to-end scenario without becoming a production capability. | User-test and manual scenario harness. | Scenario workflow result and sandbox artifacts. | Saleor docs user-test evals and scenario tests. | Remove from the production tool surface in CR1 after evals call the same primitives through fixture support. |
| `scan_watched_repositories` | `knowledge.read` and `repository.read` | Merge into resource capability | Read configured watched repositories and compare them with working docs without source mutation. | Release scanning and future watch goals. | Release cursor, provenance-bearing findings, and docs signals when escalated. | Watched-repository tests and read-only eval. | Remove after source registry reads plus a scan skill reproduce the behavior without a workflow-shaped tool. |
| `update_docs_signal_lifecycle` | `docs_work.manage` | Merge into resource capability | Apply only non-privileged triage transitions owned by this surface. | Interactive triage and provider intake. | Docs-signal lifecycle event. | Signal lifecycle tests and docs-signal evals. | Remove after the durable docs-work capability enforces equivalent transition ownership. |
| `verify_docs_signal_current_docs` | `repository.read` and `docs_work.manage` | Merge into resource capability | Inspect working docs for one signal and record verification without drafting or publishing. | Signal investigation. | Sandbox evidence, verification artifact, and signal lifecycle. | Verification tests, docs-signal evals, and user-test evals. | Remove after a skill composes working-repository reads with durable docs-work verification state. |

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
| `web_fetch` | Active | `knowledge.read` | Read a named public URL with bounded model output and no Paige mutation. | Eve turn events only. | Eve framework discovery and conversation evals. | Override or disable if provider, privacy, or output controls cannot preserve the knowledge-read contract. |
| `web_search` | Provider conditional | `knowledge.read` | Search through the selected model provider without granting external mutation. | Provider response in Eve turn events. | Eve framework discovery and conversation evals. | Override or disable if the configured provider cannot preserve the knowledge-read contract. |
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
| #60 watch goal execution | Dynamic composition of the approved subset of `knowledge.read`, `repository.read`, `docs_work.manage`, `draft.edit`, `follow_up.schedule`, and `provider.deliver`, with watch procedure supplied by a skill. | Eve watch turns. | Eve session and run, effective watch revision reference, one attached internal working document per watch, docs work, and allowed artifacts. | Capability-matrix, generic-document, skill-routing, execution, budget, behavior, and failure evals. | No permanent compatibility wrapper or watch-journal tool; execution must converge on canonical capabilities from CR2-CR7. |
| #61 watch configuration and governance | Non-delegable operator control plane over typed watch services. | Authenticated operator app and setup flows. | Proposed and effective watches, previews, approvals, lifecycle, and audit history. | Service, authorization, browser, reapproval, and fail-closed tests. | Permanent governance boundary aligned with CR9; no raw prompt or generic tool editor. |
| #62 release and docs-feedback proof | Eval fixtures and templates using one watch runtime. | Behavioral regression suite and product examples. | Eval artifacts and bounded fixture configuration only. | Cross-scenario behavior, policy, delivery, and no-purpose-specific-tool assertions. | Fixtures remain while useful; they never become production tool names or authority values. |

## Behavioral Proof Boundary

`pnpm --filter docs-agent eval --list` currently discovers 32 cases across the
conversation, documentation, provider, watched-repository, memory, authoring,
and approval surfaces. #63 changes only architecture, inventory checking, and
validation wiring.

<!-- CAPABILITY_BASELINE_START -->
The maintainer explicitly waived a full live-eval run for #63. No assertions
were weakened, and #32 and #37 retain their separate live and external proof
requirements.
<!-- CAPABILITY_BASELINE_END -->

The deterministic and local live suites do not replace external proof:

- #32 remains open until its required before-and-after live behavior comparison
  is recorded without weakening assertions.
- #37 remains open until production-like GitHub OAuth and deployment behavior
  is proved with a real operator account.

Those blockers are intentionally outside #63 and must not be closed by this
inventory.
