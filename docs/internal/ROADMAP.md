# Roadmap

## Current Appetite

The sandboxed working-repository loop, watched-repository evidence, durable docs
signals, Slack and Linear intake, patch handoff, and workspace memories are now
implemented. The product has useful state, but operators cannot see it without
asking the agent or inspecting runtime and database internals.

The first local-only web control-plane delivery is complete: the Turborepo
boundary, operator shell, one agent-owned database shared by that agent's two
server apps, and the read-service package, readiness report, docs-signal queue,
and complete signal detail are in place.
The Technical Editor epic is complete. Paige now profiles the repository,
chooses the reader-solving intervention, plans substantial work, authors complete
multi-file drafts, and owns that work durably to the next human boundary.
Bounded scheduled follow-up and durable Chat SDK state on the same agent-owned
database service, the privacy-filtered Chat SDK Slack transport, scoped
continued thread participation, and bounded user-authorized Slack context
retrieval are also complete. The authenticated operator implementation and
guided workspace onboarding are in place; the real GitHub OAuth deployment
smoke remains required before #37 is complete. Connector installation handoffs
are complete; workspace-memory review, product-level run history, and the
centralized approval inbox are also complete. Durable eval and validation result
recording and its read-only assurance UI are complete. Instruction-boundary
cleanup is implemented and awaits repository-backed eval proof in a configured
Eve environment. Structured personality and participation settings are
complete.

The next product bet is policy-bound proactive attention. An operator should be
able to delegate a bounded documentation goal over one approved provider
resource while Paige composes its existing signal, evidence, repository,
authoring, and follow-up capabilities. Watches keep source, action, retention,
budget, delivery, and approval authority structured; release-channel review and
docs-feedback triage are proof scenarios, not separate runtime workflows.

The first delivery remains the local read-only baseline. Production
authentication, guided setup, connector handoffs, workspace-memory review, run
history, approvals, assurance, and behavior settings now build on it.

The operator surface builds on the existing agent workflow contract in
`docs/internal/WORKFLOWS.md`; it does not replace or redefine those runtime
boundaries.

The accepted persistence boundary is one database per agent. The current
product still deploys one agent at a time; it does not include a SaaS registry,
database provisioning, agent switching, organizations, invitations, roles, or
shared-runtime routing. See `docs/ARCHITECTURE.md` and ADR-0005.

This appetite also rules out silent provider installation, a raw database or
workflow-state editor, a custom tracing backend, unbounded or implicit context
ingestion outside approved watch scopes, arbitrary executable workflows, and
autonomous publishing.

## Milestones

| Milestone | Goal | Done When | Issues |
| --- | --- | --- | --- |
| M0 | Project setup and operating rules | README, root instructions, and planning docs establish the Eve-first Paige contract. | #5 |
| M1 | Sandboxed GitHub working-repository loop | The agent materializes one working docs repository, enforces repository policy, prepares and checks minimal patches, exports diffs, publishes approved draft PRs, and detects missing setup. | #6, #1, #2, #4, #7, #11 |
| M2 | Safety and read-only source evidence | The repository workflow is covered for successful and fail-closed paths, and watched repositories can provide read-only release evidence. | #3, #8 |
| M3 | Durable docs-signal workflows | Slack, Linear, watched scans, patch handoff, safety evals, and workspace memories use the app-owned database and shared docs-impact model. | #20, #28, #21, #22, #23, #24, #25, #26, #27, #29 |
| M4 | Operator control plane first delivery | A local operator can see whether Paige is ready, browse the durable work queue, and inspect signal provenance, lifecycle, and artifacts. | #35, #36, #38, #39, #40, #41 |
| M5 | Policy-bound proactive attention | An operator can configure and govern a bounded Slack watch; Paige evaluates event or scheduled observations and can stay silent, reply, or create docs work through generic capabilities while scope, retention, budgets, delivery, and actions remain enforced and auditable. | #57, #58, #59, #60, #61, #62 |

## M4 Slice Plan

The repository conversion (#35), operator shell (#36), shared control-plane
services (#38), readiness report (#39), signal queue (#40), and signal detail
(#41) are complete.

The first delivery has no remaining implementation slice.

## Ordered Backlog

Use these tables as the agreed fallback order when GitHub Projects or custom
issue ordering cannot be read.

### First Delivery (Complete)

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| Complete | #41 Show docs-signal provenance, lifecycle, and artifacts | Makes the queue trustworthy by showing the complete evidence and workflow record. | #40 (complete) |

### Technical Editor

This is the next product epic after First Delivery. It turns Paige from a
constrained patching agent into a documentation coworker that understands the
repository, chooses the right intervention, plans substantial work, and carries
one coherent draft to the next human boundary.

| Order | Issue | Why Next | Depends On |
| --- | --- | --- | --- |
| Complete | #52 Build and maintain a repository docs profile | Stops Paige from rediscovering conventions and checks on every task. | #38 (complete) |
| Complete | #53 Add a complete multi-file authoring workspace | Removes the one-file exact-replacement ceiling while preserving sandbox and approval boundaries. | #38, #52 (complete) |
| Complete | #54 Plan substantial documentation work before drafting | Makes large work understandable and steerable without adding an approval gate. | #52, #53 (complete) |
| Complete | #55 Choose the right editorial intervention | Lets Paige patch, add, restructure, consolidate, remove, wait, or ask based on the reader problem. | #52, #53, #54 (complete) |
| Complete | #56 Own substantial documentation work asynchronously | Carries investigation, planning, drafting, validation, and continuation as one durable work item. | #41, #53, #54, #55 (complete) |

### Policy-Bound Watches

This epic gives Paige a reusable proactive-attention primitive without adding a
release-channel, docs-feedback, or other purpose-specific workflow. The watch
contract is provider-neutral; Slack is the first event adapter and the two
channel use cases prove the same runtime.

Tracked by #57.

| Order | Issue | Why Next | Depends On |
| --- | --- | --- | --- |
| Gate | #63 Record Paige's capability contract and migration baseline (complete) | Settles stable capability identifiers and migration destinations before persistence can encode them. This is supervised work, not part of the bounded loop. | None; ADR-0004 is accepted |
| Tracking | #58 Persist a bounded watch contract | Tracks the six persistence and policy slices without acting as an implementation task itself. | #63 (complete), #64–#69 |
| 1 | #64 Persist and retrieve a proposed policy-bound watch | Establishes the durable proposed-watch and revision boundary. | #63 (complete), #28, #38 (complete) |
| 2 | #65 Preview and validate an effective watch policy | Resolves defaults and rejects invalid authority before activation. | #64 |
| 3 | #66 Approve a watch as an immutable effective revision | Gives admission and execution a frozen approved policy reference. | #65 |
| 4 | #67 Add audited lifecycle controls for policy-bound watches | Makes pause, resume, expiry, and deletion explicit and concurrency-safe. | #66 |
| 5 | #68 Require fresh approval for watch goal and authority changes | Prevents edits from silently widening observation or action authority. | #67 |
| 6 | #69 Fail closed when watch persistence or workspace readiness is unavailable | Completes persistence readiness, failure coverage, and contract documentation. | #68 |
| Tracking | #59 Admit configured Slack events as observations | Tracks the six provider-admission slices without acting as an implementation task itself. | Starts after #66; admission continues after #69 |
| 7 | #70 Represent admitted provider events as ephemeral observations | Establishes the provider-neutral, privacy-bounded handoff contract. | #66 |
| 8 | #71 Admit Slack events only for active configured watches | Extends the pre-model boundary only for explicitly active watch scopes. | #69, #70, #33, #34 |
| 9 | #72 Normalize supported Slack watch events and reject unsafe subtypes | Keeps bot output, self-authored events, and unsupported subtypes outside observation processing. | #71 |
| 10 | #73 Deduplicate watched Slack events across retries and restarts | Adds a minimal durable claim without retaining raw provider content. | #72 |
| 11 | #74 Assemble bounded windows of admitted watch observations | Supports per-event and bounded-window handoff without unbounded ingestion. | #73 |
| 12 | #75 Recheck watch authority and budgets before observation dispatch | Freezes the final admission boundary without starting the later watch-turn executor. | #74 |
| 13 | #60 Execute watch goals with composable docs capabilities | Makes the model compose generic actions while runtime policy constrains authority, timing, and delivery. | #58, #59, #32 implementation, CR2, CR3, CR4, CR6, CR7 |
| 14 | #61 Configure and govern watches | Adds preview, approval, lifecycle management, and reapproval for authority expansion over shared services. | #58; authenticated web management also needs #37 |
| 15 | #62 Prove one runtime across release and docs-feedback channels | Demonstrates that materially different goals need configuration and eval fixtures, not separate workflow code. | #59, #60, #61 |

### Later Backlog

| Order | Issue | Why Later | Depends On |
| --- | --- | --- | --- |
| Complete | #51 Run scheduled follow-ups | Adds bounded proactive maintenance after the shared signal service exists. | #38 (complete) |
| Complete | #33 Persist Chat SDK state in libSQL/Turso | Adds durable subscription and debounce state inside the current agent's database boundary. | #38 (complete) |
| Complete | #34 Replace Eve's native Slack channel with Chat SDK | Establishes the transport and privacy boundary needed for continued participation. | #33 (complete) |
| Complete | #30 Keep participating after a Slack mention | Makes Paige a scoped thread participant rather than a repeatedly invoked bot. | #33, #34 (complete) |
| Complete | #49 Retrieve missing Slack context on demand | Adds bounded, user-authorized retrieval without ambient ingestion. | #34 (complete) |
| 11 | #37 Deploy and protect the operator app | Adds remote access only after the local control plane proves its value and boundaries. | #41 (complete) |
| Complete | #42 Add guided workspace onboarding | Adds authenticated setup mutations after the readiness model proves what users need. | #37 implementation, #39 (complete) |
| Complete | #43 Add connector installation handoffs | Improves installation without pretending provider consent can be silent. | #37 implementation, #39 (complete) |
| Complete | #44 Add workspace-memory review | Exposes an existing human-governed lifecycle in the authenticated app. | #37 implementation, #38 (complete) |
| Complete | #45 Add product-level run history and trace links | Connects product work to Eve and Vercel traces without building a second runtime. | #37 implementation, #38 (complete) |
| Complete | #47 Add a centralized approval inbox | Aggregates pending side effects while Eve remains the approval source of truth. | #37 implementation, #38, #41, #45 (complete) |
| Complete | #50 Record eval and validation results | Establishes a durable, redacted result source before the assurance UI. | #38 (complete) |
| Complete | #48 Show eval results and behavioral regressions | Renders recorded assurance data without inventing browser-side execution. | #36, #37 implementation, #50 (complete) |
| 19 | #32 Reduce always-on instruction bloat | Moves situational workflows into the right Eve context boundaries without changing behavior. | None |
| Complete | #46 Add personality and participation settings | Tunes tested defaults without exposing raw prompts or widening authority. | #30, #31, #32 implementation, #37 implementation, #38 (complete) |

## Later

- A SaaS control plane for organizations, agent provisioning and switching,
  invitations, roles, billing, and shared-runtime routing. Any future SaaS must
  preserve one database per agent.
- Production deployment and remote operator authentication before the local
  control-plane delivery is proven.
- Operator mutations for signal priority, lifecycle, and next action.
- Notifications, usage, retention, and data-management controls beyond the
  bounded scheduled follow-up and watch policies.
- Broader source and context repository access beyond watched release scans.
- Discord, Notion, support systems, or other team surfaces.
- Scheduled stale-doc detection beyond explicitly configured scans.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.
