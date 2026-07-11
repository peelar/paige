# Roadmap

## Current Appetite

The sandboxed working-repository loop, watched-repository evidence, durable docs
signals, Slack and Linear intake, patch handoff, and workspace memories are now
implemented. The product has useful state, but operators cannot see it without
asking the agent or inspecting runtime and database internals.

The current appetite is to finish the first local-only web control-plane
delivery. The Turborepo boundary and operator shell are complete. The remaining
work is to share the app-owned database and read-service boundary, show setup
and runtime readiness, and expose the docs-signal queue and full signal detail.

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

The repository conversion (#35) and operator shell (#36) are complete.

1. Extract shared database and read services. (#38)
   Give the agent and web app one typed app-owned boundary without exposing raw
   tables to the browser.

2. Show readiness. (#39)
   Report whether the database, runtime, repositories, writeback, and channels
   are configured, reachable, and verified.

3. Show the work queue. (#40)
   List existing docs signals with useful status, source, priority, uncertainty,
   and next-action context.

4. Show signal detail. (#41)
   Present provenance, claims, missing evidence, lifecycle events, reports,
   checks, diffs, and draft PR artifacts.

## Ordered Backlog

Use these tables as the agreed fallback order when GitHub Projects or custom
issue ordering cannot be read.

### First Delivery

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| 1 | #38 Extract shared database and control-plane services | Prevents the web app from duplicating agent persistence or importing raw tools. | #35 (complete) |
| 2 | #39 Show Docs Agent setup and runtime readiness | Delivers the first useful onboarding surface: is everything ready, and if not, why? | #38 |
| 3 | #40 Show the docs-signal work queue | Exposes the existing durable work product with very little new domain behavior. | #38 |
| 4 | #41 Show docs-signal provenance, lifecycle, and artifacts | Makes the queue trustworthy by showing the complete evidence and workflow record. | #40 |

### Technical Editor

This is the next product epic after First Delivery. It turns Paige from a
constrained patching agent into a documentation coworker that understands the
repository, chooses the right intervention, plans substantial work, and carries
one coherent draft to the next human boundary.

| Order | Issue | Why Next | Depends On |
| --- | --- | --- | --- |
| 5 | #52 Build and maintain a repository docs profile | Stops Paige from rediscovering conventions and checks on every task. | #38 |
| 6 | #53 Add a complete multi-file authoring workspace | Removes the one-file exact-replacement ceiling while preserving sandbox and approval boundaries. | #38, #52 |
| 7 | #54 Plan substantial documentation work before drafting | Makes large work understandable and steerable without adding an approval gate. | #52, #53 |
| 8 | #55 Choose the right editorial intervention | Lets Paige patch, add, restructure, consolidate, remove, wait, or ask based on the reader problem. | #52, #53, #54 |
| 9 | #56 Own substantial documentation work asynchronously | Carries investigation, planning, drafting, validation, and continuation as one durable work item. | #41, #53, #54, #55 |

### Later Backlog

| Order | Issue | Why Later | Depends On |
| --- | --- | --- | --- |
| 10 | #51 Run scheduled follow-ups | Adds bounded proactive maintenance after the shared signal service exists. | #38 |
| 11 | #33 Persist Chat SDK state in libSQL/Turso | Adds durable subscription and debounce state through the shared database boundary. | #38 |
| 12 | #34 Replace Eve's native Slack channel with Chat SDK | Establishes the transport and privacy boundary needed for continued participation. | #33 |
| 13 | #30 Keep participating after a Slack mention | Makes Paige a scoped thread participant rather than a repeatedly invoked bot. | #33, #34 |
| 14 | #49 Retrieve missing Slack context on demand | Adds bounded, user-authorized retrieval without ambient ingestion. | #34 |
| 15 | #37 Deploy and protect the operator app | Adds remote access only after the local control plane proves its value and boundaries. | #41 |
| 16 | #42 Add guided workspace onboarding | Adds authenticated setup mutations after the readiness model proves what users need. | #37, #39 |
| 17 | #43 Add connector installation handoffs | Improves installation without pretending provider consent can be silent. | #37, #39 |
| 18 | #44 Add workspace-memory review | Exposes an existing human-governed lifecycle in the authenticated app. | #37, #38 |
| 19 | #45 Add product-level run history and trace links | Connects product work to Eve and Vercel traces without building a second runtime. | #37, #38 |
| 20 | #47 Add a centralized approval inbox | Aggregates pending side effects while Eve remains the approval source of truth. | #37, #38, #41, #45 |
| 21 | #50 Record eval and validation results | Establishes a durable, redacted result source before the assurance UI. | #38 |
| 22 | #48 Show eval results and behavioral regressions | Renders recorded assurance data without inventing browser-side execution. | #36 (complete), #37, #50 |
| 23 | #32 Reduce always-on instruction bloat | Moves situational workflows into the right Eve context boundaries without changing behavior. | None |
| 24 | #46 Add personality and participation settings | Tunes tested defaults without exposing raw prompts or widening authority. | #30, #31 (complete), #32, #37, #38 |

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
