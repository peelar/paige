# Roadmap

## Current Appetite

The sandboxed working-repository loop, watched-repository evidence, durable docs
signals, Slack and Linear intake, patch handoff, and workspace memories are now
implemented. The product has useful state, but operators cannot see it without
asking the agent or inspecting runtime and database internals.

The first local-only web control-plane delivery is complete: the Turborepo
boundary, operator shell, shared app-owned database and read-service package,
readiness report, docs-signal queue, and complete signal detail are in place.
The Technical Editor epic is complete. Paige now profiles the repository,
chooses the reader-solving intervention, plans substantial work, authors complete
multi-file drafts, and owns that work durably to the next human boundary.
Bounded scheduled follow-up and durable Chat SDK state on the shared database
service, the privacy-filtered Chat SDK Slack transport, and scoped continued
thread participation are also complete. The next appetite is bounded,
user-authorized retrieval of missing Slack context.

The first delivery is read-only and bound to the local machine. Production
deployment and authentication, guided setup, connector handoffs,
workspace-memory review, run history, personality and participation settings,
approvals, and eval reporting stay below it in the backlog.

The operator surface builds on the existing agent workflow contract in
`docs/WORKFLOWS.md`; it does not replace or redefine those runtime boundaries.

This appetite still rules out multi-workspace accounts and roles, silent
provider installation, a raw database or workflow-state editor, a custom
tracing backend, broad context ingestion, and autonomous publishing.

## Milestones

| Milestone | Goal | Done When | Issues |
| --- | --- | --- | --- |
| M0 | Project setup and operating rules | README, root instructions, and planning docs establish the Eve-first Docs Agent contract. | #5 |
| M1 | Sandboxed GitHub working-repository loop | The agent materializes one working docs repository, enforces repository policy, prepares and checks minimal patches, exports diffs, publishes approved draft PRs, and detects missing setup. | #6, #1, #2, #4, #7, #11 |
| M2 | Safety and read-only source evidence | The repository workflow is covered for successful and fail-closed paths, and watched repositories can provide read-only release evidence. | #3, #8 |
| M3 | Durable docs-signal workflows | Slack, Linear, watched scans, patch handoff, safety evals, and workspace memories use the app-owned database and shared docs-impact model. | #20, #28, #21, #22, #23, #24, #25, #26, #27, #29 |
| M4 | Operator control plane first delivery | A local operator can see whether Docs Agent is ready, browse the durable work queue, and inspect signal provenance, lifecycle, and artifacts. | #35, #36, #38, #39, #40, #41 |

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

### Later Backlog

| Order | Issue | Why Later | Depends On |
| --- | --- | --- | --- |
| Complete | #51 Run scheduled follow-ups | Adds bounded proactive maintenance after the shared signal service exists. | #38 (complete) |
| Complete | #33 Persist Chat SDK state in libSQL/Turso | Adds durable subscription and debounce state through the shared database boundary. | #38 (complete) |
| Complete | #34 Replace Eve's native Slack channel with Chat SDK | Establishes the transport and privacy boundary needed for continued participation. | #33 (complete) |
| Complete | #30 Keep participating after a Slack mention | Makes Paige a scoped thread participant rather than a repeatedly invoked bot. | #33, #34 (complete) |
| 10 | #49 Retrieve missing Slack context on demand | Adds bounded, user-authorized retrieval without ambient ingestion. | #34 |
| 11 | #37 Deploy and protect the operator app | Adds remote access only after the local control plane proves its value and boundaries. | #41 (complete) |
| 12 | #42 Add guided workspace onboarding | Adds authenticated setup mutations after the readiness model proves what users need. | #37, #39 (complete) |
| 13 | #43 Add connector installation handoffs | Improves installation without pretending provider consent can be silent. | #37, #39 (complete) |
| 14 | #44 Add workspace-memory review | Exposes an existing human-governed lifecycle in the authenticated app. | #37, #38 |
| 15 | #45 Add product-level run history and trace links | Connects product work to Eve and Vercel traces without building a second runtime. | #37, #38 |
| 16 | #47 Add a centralized approval inbox | Aggregates pending side effects while Eve remains the approval source of truth. | #37, #38, #41 (complete), #45 |
| 17 | #50 Record eval and validation results | Establishes a durable, redacted result source before the assurance UI. | #38 |
| 18 | #48 Show eval results and behavioral regressions | Renders recorded assurance data without inventing browser-side execution. | #36 (complete), #37, #50 |
| 19 | #32 Reduce always-on instruction bloat | Moves situational workflows into the right Eve context boundaries without changing behavior. | None |
| 20 | #46 Add personality and participation settings | Tunes tested defaults without exposing raw prompts or widening authority. | #30, #31 (complete), #32, #37, #38 |

## Later

- Multi-workspace accounts, invitations, and roles.
- Production deployment and remote operator authentication before the local
  control-plane delivery is proven.
- Operator mutations for signal priority, lifecycle, and next action.
- Notifications, usage, retention, and data-management controls beyond the
  bounded scheduled follow-up workflow.
- Broader source and context repository access beyond watched release scans.
- Discord, Notion, support systems, or other team surfaces.
- Scheduled stale-doc detection beyond explicitly configured scans.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.
