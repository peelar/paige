# Roadmap

## Current Appetite

The sandboxed working-repository loop, watched-repository evidence, durable docs
signals, Slack and Linear intake, patch handoff, and workspace memories are now
implemented. The product has useful state, but operators cannot see it without
asking the agent or inspecting runtime and database internals.

The current appetite is the first web control-plane delivery:

1. establish a Turborepo boundary with separate Eve and Next.js apps;
2. add the operator shell and production authentication;
3. share the smallest app-owned database and read-service boundary;
4. show setup and runtime readiness;
5. show the docs-signal queue and full signal detail.

The first delivery is read-only after authentication. Guided setup, connector
handoffs, workspace-memory review, run history, personality and participation
settings, approvals, and eval reporting stay below it in the backlog.

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
| M4 | Operator control plane first delivery | An authenticated operator can see whether Docs Agent is ready, browse the durable work queue, and inspect signal provenance, lifecycle, and artifacts. | #35, #36, #37, #38, #39, #40, #41 |

## M4 Slice Plan

0. Convert the repository to a Turborepo. (#35)
   Move the Eve runtime into `apps/agent`, add a minimal Next.js app under
   `apps/web`, and keep `pnpm check` authoritative.

1. Add the operator app shell. (#36)
   Establish navigation and UI conventions without fake product data.

2. Add production authentication. (#37)
   Protect the single-workspace operator surface and its server-side actions.

3. Extract shared database and read services. (#38)
   Give the agent and web app one typed app-owned boundary without exposing raw
   tables to the browser.

4. Show readiness. (#39)
   Report whether the database, runtime, repositories, writeback, and channels
   are configured, reachable, and verified.

5. Show the work queue. (#40)
   List existing docs signals with useful status, source, priority, uncertainty,
   and next-action context.

6. Show signal detail. (#41)
   Present provenance, claims, missing evidence, lifecycle events, reports,
   checks, diffs, and draft PR artifacts.

## Ordered Backlog

Use these tables as the agreed fallback order when GitHub Projects or custom
issue ordering cannot be read.

### First Delivery

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| 0 | #35 Convert the repository to a Turborepo with agent and web apps | Establishes the deployable app boundary before web work starts. | None |
| 1 | #36 Add the Next.js operator app shell | Gives later screens one real UI structure without inventing data. | #35 |
| 2 | #37 Protect the web app with single-workspace operator authentication | Makes every later product read and action fail closed in production. | #36 |
| 3 | #38 Extract shared database and control-plane services | Prevents the web app from duplicating agent persistence or importing raw tools. | #35 |
| 4 | #39 Show Docs Agent setup and runtime readiness | Delivers the first useful onboarding surface: is everything ready, and if not, why? | #37, #38 |
| 5 | #40 Show the docs-signal work queue | Exposes the existing durable work product with very little new domain behavior. | #37, #38 |
| 6 | #41 Show docs-signal provenance, lifecycle, and artifacts | Makes the queue trustworthy by showing the complete evidence and workflow record. | #40 |

### Later Backlog

| Order | Issue | Why Later | Depends On |
| --- | --- | --- | --- |
| 7 | #42 Add guided workspace onboarding from the Status page | Adds setup mutations after the readiness model proves what users need. | #39 |
| 8 | #43 Add connector installation handoffs and verification | Improves installation without pretending provider consent can be silent. | #39 |
| 9 | #44 Add workspace-memory review to the web app | Exposes an existing human-governed lifecycle after the core signal UI. | #37, #38 |
| 10 | #45 Add product-level run history and trace links | Connects product work to Eve and Vercel traces without building a second runtime. | #37, #38 |
| 11 | #47 Add a centralized approval inbox | Aggregates pending side effects after signal detail and the product run index can discover parked sessions. | #37, #38, #41, #45 |
| 12 | #50 Record eval and validation results for the control plane | Establishes a durable, redacted result source before the assurance UI. | #38 |
| 13 | #48 Show eval results and behavioral regressions | Renders the recorded assurance data without inventing a browser-side execution path. | #36, #37, #50 |
| 14 | #32 Reduce always-on instruction bloat without changing agent behavior | Establishes the instruction boundary required by the identity work. | None |
| 15 | #31 Define and express Docs Agent's technical-editor identity | Sets the product default before personality becomes configurable. | #32 |
| 16 | #33 Persist Chat SDK state in the existing libSQL/Turso database | Adds durable subscription and debounce state through the shared database boundary. | #38 |
| 17 | #34 Replace Eve's native Slack channel with Chat SDK Slack integration | Establishes the transport and privacy boundary needed for continued participation. | #33 |
| 18 | #30 Let Docs Agent keep participating after it is mentioned in a Slack thread | Defines the default participation lifecycle before exposing settings. | #33, #34 |
| 19 | #49 Let Docs Agent retrieve missing Slack context on demand | Adds bounded, user-authorized retrieval after the Chat SDK transport and privacy boundary exist. | #34 |
| 20 | #46 Add structured personality and participation settings | Tunes tested defaults without exposing raw prompts or widening authority. | #30, #31, #32, #37, #38 |

## Later

- Multi-workspace accounts, invitations, and roles.
- Operator mutations for signal priority, lifecycle, and next action.
- Schedules, notifications, usage, retention, and data-management controls.
- Broader source and context repository access beyond watched release scans.
- Discord, Notion, support systems, or other team surfaces.
- Scheduled stale-doc detection beyond explicitly configured scans.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.
