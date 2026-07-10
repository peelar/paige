# Roadmap

## Current Appetite

The current repository foundation should remain narrow enough to validate with
one configured GitHub working documentation repository cloned or materialized
into the Eve Vercel sandbox. That foundation proves that the agent can
materialize the repository, enforce allowed repository actions, reason about a
change, prepare a minimal patch when warranted, run checks, export a diff,
automatically collect required workspace setup, publish approved changes back to
GitHub, and scan configured watched repositories for read-only release signals.

The next product appetite is one focused expansion: Slack and Linear docs-signal
intake with on-demand verification against the configured working documentation
repository. Docs Agent should mimic practical docs loops: being mentioned in
conversations, participating in Linear issues or initiatives, checking
release/project signals, deciding whether docs verification is needed, and
escalating to patch/writeback only through the existing approval boundary.

This appetite still rules out broad multi-surface chat routing, ambient scraping
of all company context, autonomous publishing, broad source-repository
integration, broad context-repository integration, and broad documentation
platform support.

## Milestones

| Milestone | Goal | Done When | Issues |
| --- | --- | --- | --- |
| M0 | Project setup and operating rules | README, root instructions, and planning docs establish the Eve-first Docs Agent contract. | #5 |
| M1 | Sandboxed GitHub working-repository loop | The agent materializes one GitHub working repository in the Eve Vercel sandbox, enforces allowed repository actions, prepares and checks minimal patches, exports diffs, can push approved changes to a draft PR, and detects missing setup automatically before normal work. | #6, #1, #2, #4, #7, #11 |
| M2 | Safety and read-only source evidence | The sandboxed repository workflow is covered for successful paths and fail-closed behavior, and configured watched repositories can be scanned as read-only evidence sources. | #3, #8 |
| M3 | Slack and Linear docs-signal intake | Slack threads and Linear issues can become durable docs signals, the agent decides whether docs verification is needed, substantive signals are checked against the configured working docs repository, and patch/writeback remains gated. | #20, #28, #21, #22, #23, #24, #25, #26, #27 |

## M1 Slice Plan

0. Establish project setup and operating rules.
   Capture the README, root instructions, validation commands, and documentation
   repository rules needed before implementing the scenario-backed workflow.

1. Define repository model.
   Capture the working documentation repository as the primary mutable target
   inside the Eve Vercel sandbox, plus the typed input contract and explicit
   no-fallback behavior.

2. Materialize the GitHub working repository.
   Parse the repository input, reject unsupported sources, default the ref when
   omitted, clone or materialize into `/workspace/working-docs`, detect the docs
   root when omitted, and record provenance.

3. Add a policy-aware repository action runner.
   Gate clone, read, search, patch, run-checks, and export-diff actions against
   the repository contract and fail closed for unsupported actions or paths.

4. Patch, check, and export inside the sandbox.
   Emit the impact report, prepare minimal Markdown or MDX patches, run checks,
   and export a reviewable diff artifact through the action runner.

5. Add automatic setup gate.
   Check required workspace configuration at the start of each turn, guide the
   model into setup mode when fields are missing or stale, and enforce the same
   setup boundary inside docs-maintenance and writeback tools. Persist reusable
   repository setup separately from one-off scenario context.

6. Push approved changes to GitHub.
   After explicit approval, create a branch, push the sandboxed diff, and open a
   draft PR in the working repository with report, evidence, checks, and
   uncertainty.

7. Add safety and regression coverage.
   Cover successful materialization, denied actions, unsupported sources,
   patch/check/diff behavior, approval-required writeback, and primary report
   decisions.

8. Add watched repository release scans.
   Persist configured watched repositories as read-only source evidence, inspect
   recent release signals, verify candidates in sandboxed read-only checkouts,
   compare them with the working docs repository, and emit a report without
   writing to watched repositories.

## Ordered Backlog

Use this table as the agreed fallback order when GitHub Projects or custom issue
ordering cannot be read.

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| 0 | #5 Establish project setup and Docs Agent operating rules | Gives contributors and agents the stable Eve-first setup needed before the workflow implementation. | None |
| 1 | #6 Define working docs and context repository model | Makes the central mutable docs repository and sandbox boundary explicit before workflow schemas harden. | #5 |
| 2 | #1 Materialize a GitHub working repository in the sandbox | Proves the first real repository boundary before inspection, patching, or writeback. | #6 |
| 3 | #2 Add a policy-aware repository action runner | Makes `allowedActions` enforceable before patches and checks can use the repository. | #1, #6 |
| 4 | #4 Patch, check, and export diffs inside the sandbox | Turns repository access into useful docs work without granting push authority yet. | #1, #2, #6 |
| 5 | #11 Add automatic setup gate for required workspace configuration | Makes setup drift visible and collectible on every turn before docs work or writeback run in any channel. | #1, #2, #4, #6, #7 |
| 6 | #7 Push approved sandbox changes to a draft GitHub PR | Adds controlled writeback after sandbox-local behavior is proven. | #1, #2, #4, #6 |
| 7 | #3 Add safety evals for the sandboxed GitHub repository workflow | Locks in successful paths and fail-closed behavior after the full working-repository loop exists. | #1, #2, #4, #7, #11, #6 |
| 8 | #8 Add watched repository support for read-only source evidence | Adds narrow release-signal source evidence without granting write authority outside the working docs repository. | #7, #11 |
| 9 | #20 Decide persistence for docs signals and workflow state | Chooses durable storage before the signal queue bakes in the wrong state boundary. | #8 |
| 10 | #28 Add database foundation and migrate setup persistence | Puts the Drizzle/libSQL storage boundary and existing setup persistence migration in place before product workflow state lands. | #20 |
| 11 | #21 Add a docs signal work queue | Gives Slack, Linear, watched scans, and future schedules one provider-neutral work item model. | #20, #28 |
| 12 | #22 Generalize the docs-impact decision model across signals and evidence | Prevents Slack, Linear, watched scans, and scenarios from inventing separate outcome vocabularies. | #21 |
| 13 | #23 Model Docs Agent workflows for signals, scans, initiatives, release readiness, and patch handoff | Names the real docs loops before channel intake maps everything onto one scenario runner. | #21, #22 |
| 14 | #24 Add Slack docs-signal intake with on-demand docs verification | Captures explicit Slack thread context where product and support information moves. | #21, #22, #23 |
| 15 | #25 Add Linear docs-signal intake with on-demand docs verification | Captures Linear issue and Agent Session context as Docs Agent work. | #21, #22, #23 |
| 16 | #26 Connect docs-signal verification to patch and writeback handoff | Lets verified stale-docs signals reuse the existing patch/check/diff and approved PR path. | #21, #22, #23 |
| 17 | #27 Add evals and safety coverage for Slack and Linear docs-signal workflows | Locks down provenance, skipped-verification reasons, verification behavior, and approval boundaries. | #21, #22, #23, #24, #25, #26 |

## Later

- Broader source/context repository access beyond watched release scans.
- Discord, Notion, support system, or other team surfaces after Slack and Linear
  prove the signal intake model.
- Vercel Connect-backed access to private team context.
- Scheduled stale-doc detection beyond explicitly configured scans.
- Persistent style and information-architecture maps.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.

## M3 Slice Plan

0. Decide persistence for docs signals and workflow state. (#20)
   Choose where durable signal records, cross-channel provenance, lifecycle
   status, and verification results live before adding a signal work queue.

1. Add database foundation and migrate setup persistence. (#28)
   Add the Drizzle/libSQL database foundation and make non-session setup
   persistence database-only before product workflow state lands.

2. Add a docs signal work queue. (#21)
   Store provider-neutral docs signals from Slack, Linear, watched repositories,
   and future schedules with provenance, relationships, uncertainty, and
   lifecycle status.

3. Generalize the docs-impact decision model. (#22)
   Extract the existing report-first decisions so Slack, Linear, release scans,
   repository scenarios, and future scheduled scans share the same vocabulary and
   escalation logic.

4. Model Docs Agent workflows explicitly. (#23)
   Represent the everyday loops: mentioned in context, periodic scans, initiative
   or project participation, release readiness, current-docs verification, and
   patch handoff. The durable contract lives in `docs/WORKFLOWS.md`.

5. Add Slack intake. (#24)
   Capture explicit Slack thread mentions as communication-thread signals, run
   the shared decision workflow, and verify current docs when warranted.

6. Add Linear intake. (#25)
   Capture delegated or mentioned Linear issues as issue-tracker-item signals,
   run the shared decision workflow, and verify current docs when warranted.

7. Connect signal verification to patch/writeback handoff. (#26)
   When verification produces a warranted docs patch, reuse the sandboxed
   working-repository patch/check/diff path and keep draft PR publishing behind
   explicit approval.

8. Add signal-workflow evals and safety coverage. (#27)
   Cover Slack intake, Linear intake, skipped-verification reasons,
   on-demand sandbox verification, provenance joining, and no unapproved
   writeback.
