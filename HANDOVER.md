# Handover

## #20 Decide persistence for docs signals and workflow state

Decision: docs signals and workflow state belong in an app-owned
Drizzle/libSQL database, not repo-local JSON, Eve session state, GitHub
comments, Slack, or Linear.

Design: ADR-0001 records the storage choice, the minimum signal records, the
query needs, and fail-visible behavior. `docs/REPOSITORY_MODEL.md` carries the
same boundary in product terms.

User effect: future Slack, Linear, watched-repository, and scheduled docs work
can survive restarts and handoffs without pretending provider comments are the
source of truth.

Behavior verification: read ADR-0001 and the repository model. The expected
behavior is that durable signal capture requires database storage; one-off
answers may still be given, but queued signal/workflow claims must not be
silently dropped when storage is unavailable.

## #28 Add database foundation and migrate setup persistence

Decision: setup persistence now uses the same app-owned Drizzle/libSQL database
boundary as future signal state, while remaining a separate setup record.

Design: add a `workspace_setup` table, Drizzle config, migration script, and a
runtime DB client. Local dev defaults to `.docs-agent/docs-agent.sqlite`.
Deployed runtimes require `DOCS_AGENT_DATABASE_URL`. Setup reads and writes use
only the database; existing `.docs-agent/config.json` files are ignored.

User effect: users keep the same setup tools and setup-mode behavior, but setup
state is durable in the real app store instead of a JSON side file. Missing or
broken storage is reported before docs maintenance proceeds.

Behavior verification: run `pnpm check`. Behaviorally, first-run setup should
still ask for the working documentation repository, configured setup should be
remembered across turns, stale JSON setup should be ignored, and deployed
runtime without `DOCS_AGENT_DATABASE_URL` should fail visibly.

## #21 Add a docs signal work queue

Decision: docs signals are provider-neutral workflow records in the app
database. They are not setup config, Slack state, Linear state, or docs patches.

Design: add `docs_signals`, source, link, artifact, and event tables. Raw source
text and provider ids live in source rows; model summaries and extracted claims
live on the signal. The runtime owns workspace scoping and exposes small tools
to create, list, read, and lifecycle-update signals.

User effect: Slack, Linear, watched releases, and future scheduled scans can all
create the same kind of durable docs work item before channel-specific behavior
exists.

Behavior verification: run `pnpm check`. Behaviorally, creating the same Slack
thread or Linear permalink twice should return one signal, open-signal lists
should hide closed signals, lifecycle updates should append events, and missing
or stale storage should fail visibly.

## #22 Generalize the docs-impact decision model across signals and evidence

Decision: use one shared docs-impact decision record for signal triage and
future Slack/Linear flows, while keeping old scenario outputs compatible.

Design: add a shared schema with decision, reason, evidence, missing evidence,
current-docs verification state, recommended next action, and uncertainty. Add a
small deterministic planner for the core policy cases and map old
`docs-patch`/`no-docs-change`/`ask-maintainer` values into the new vocabulary.

User effect: Slack, Linear, watched releases, and scenario runs can make the
same kind of docs-impact decision. Internal-only signals skip verification with
a reason; substantive source-backed signals ask to verify current docs; Slack or
Linear context alone asks for source evidence before public docs claims.

Behavior verification: run `pnpm check`. Behaviorally, an internal-only signal
should not open the docs sandbox, a substantive source-backed signal should ask
to verify current docs, and a discussion-only public claim should request source
or release evidence first.

## #23 Model docs maintainer workflows for signals, scans, initiatives, release readiness, and patch handoff

Decision: document workflows as product/runtime contracts before adding Slack or
Linear channels.

Design: add `docs/WORKFLOWS.md` with six workflows, runtime boundaries, current
tool mapping, and two realistic Slack/Linear scenario outlines. Keep
`run_docs_maintenance_scenario` as the eval/scenario terminal workflow for now;
a later signal-verification wrapper should reuse the repository workflow pieces.

User effect: users get clearer behavior: mention/context intake creates a
signal, decisioning decides whether docs verification is needed, verification is
separate from patching, and publishing still requires approval.

Behavior verification: run `pnpm check`. Behaviorally, a Slack mention with
source evidence should become a signal and then request current-docs
verification; a Linear issue without source evidence should become a signal but
skip sandbox verification until evidence exists.

## #24 Add Slack docs-signal intake with on-demand docs verification

Decision: Slack support starts with explicit app mentions and DMs only. Slack
threads become structured `communication-thread` external context and durable
docs signals; Slack is not an ambient ingestion source or a writeback target.

Design: add an Eve Slack channel using Vercel Connect credentials and thread
context since the last agent reply. Add `capture_slack_docs_signal` to preserve
channel/thread ids, permalinks, authors, timestamps, captured-at time, and raw
source text in signal provenance while returning only structured summaries and
decision state to the model. Add `verify_docs_signal_current_docs` to
materialize the configured working documentation repository, read likely docs
pages, search likely docs terms, record `docs-verified`, and return evidence
without patching or publishing. The tools use the shared decision model and
setup gate: substantive source-backed signals require current-docs verification,
setup gaps block verification visibly, and skipped verification needs an
explicit reason.

User effect: mentioning Docs Agent in Slack can create or dedupe a work queue
item and produce an in-thread answer with captured summary, evidence, decision,
verification status, uncertainty, and next action. It still does not prepare a
patch, publish, or open a draft PR without a later approved handoff.

Behavior verification: run `pnpm check`. Behaviorally, a source-backed Slack
thread should capture provenance and request setup-gated docs verification, a
ready setup should let `verify_docs_signal_current_docs` inspect current docs
without producing a patch, a thread with supplied working-docs evidence should
record completed verification, and an internal-only thread should skip
verification with the stated reason.

## #25 Add Linear docs-signal intake with on-demand docs verification

Decision: Linear support starts with Eve Linear Agent Sessions for delegated or
prompted issue context. Linear issues become structured `issue-tracker-item`
external context and durable docs signals; Linear is not crawled broadly and the
agent does not edit issues, statuses, or projects in this slice.

Design: add an Eve Linear channel at `/eve/v1/linear` using Eve's default
Linear Agent Session credential environment. Add `capture_linear_docs_signal`
to preserve organization, Agent Session, activity, comment, issue, identifier,
title, URL, labels, project, status, authors, timestamps, captured-at time, and
raw prompt/comment text in signal provenance while returning structured
summaries and decision state to the model. Linear intake uses the same shared
decision model, setup gate, and `verify_docs_signal_current_docs` handoff as
Slack.

User effect: delegating or prompting Docs Agent in Linear can create or dedupe a
work queue item and produce an Agent Activity response with captured summary,
evidence, decision, verification status, uncertainty, and next action. It still
does not prepare a patch, mutate Linear issue fields, publish, or open a draft
PR without a later approved handoff.

Behavior verification: run `pnpm check`. Behaviorally, a source-backed Linear
issue should capture provenance and request setup-gated docs verification, a
ready setup should let `verify_docs_signal_current_docs` inspect current docs
without producing a patch, a Linear issue with supplied working-docs evidence
should record completed verification, and an internal-only Linear issue should
skip verification with the stated reason.

## #26 Connect docs-signal verification to patch and writeback handoff

Decision: verified docs signals hand off to the existing configured working
documentation repository workflow. The handoff does not add Slack, Linear,
watched-repository, source-repository, or autonomous publish authority.

Design: add `prepare_docs_signal_patch` for provider-neutral signal-to-patch
handoff. It starts from an existing `docs-verified` signal, refuses closed or
source-evidence-blocked signals, resets/reuses the configured working docs
checkout, applies a minimal replacement through `replaceRepositoryText`, runs
existing repository checks, exports the diff, saves `lastResult` for the
existing publish path, and updates signal lifecycle to `patch-prepared`,
`patch-failed`, or closed as no-patch. Extend `publish_working_repository_pr`
with optional `signalId`; the tool remains approval-required and marks a
`patch-prepared` signal as `draft-pr-opened` only after successful approved PR
creation.

User effect: a verified stale Slack, Linear, watched, scheduled, or manual
signal can become a reviewable docs diff with source provenance preserved in
the report and PR body. Failed checks or no-patch outcomes are recorded on the
signal instead of being hidden. Draft PR creation still waits for explicit human
approval.

Behavior verification: run `pnpm check`. Behaviorally, unverified or
source-evidence-blocked signals should be refused, verified signals can enter
patch or no-patch handoff, failed checks move to `patch-failed`, successful
patches move to `patch-prepared`, and approved publish with `signalId` records
`draft-pr-opened` with the draft PR artifact.

## #27 Add evals and safety coverage for Slack and Linear docs-signal workflows

Decision: signal workflow coverage lives in two layers: model-facing Eve evals
for the channel tool sequence, and deterministic runtime checks for exact
lifecycle and safety boundaries.

Design: add `apps/agent/evals/docs-signal-workflows.eval.ts` with one Slack case that
captures a source-backed Slack signal, asserts current-docs verification is
required, and verifies missing setup blocks repository verification before any
patch or PR tools are called; and one Linear case that captures an issue
missing source evidence and asserts no repository setup, verification, patch, or
publish tools run. Add
`apps/agent/scripts/check-docs-signal-workflow-safety.ts` to join Slack/Linear intake,
shared decision policy, setup-gated verification, source-evidence refusal, and
patch-handoff eligibility in `pnpm test`.

User effect: maintainers can regression-test the M3 Slack and Linear promise:
substantive source-backed signals verify current docs, internal-only signals
skip with a concrete reason, discussion-only public claims request source
evidence, and neither channel flow writes docs or opens a PR without the later
approved handoff.

Behavior verification: run `pnpm check`. To exercise the live model-facing
flow, run `pnpm eval docs-signal-workflows --skip-report --verbose`. The
expected behavior is Slack capture plus setup-gated current-docs verification
blocking with no patch or PR, and Linear source-evidence blocking with no
sandbox verification or writeback.

## #29 Add workspace memories for docs context

Decision: reusable docs context is app-owned workspace memory, not
docs signals, setup state, Eve `defineState`, Eve skills, or generated docs.
Stored memory is routing and triage context only; it is not proof for public
documentation claims.

Design: add Drizzle/libSQL tables for workspace memories, provenance sources,
and lifecycle events. Add `apps/agent/agent/lib/workspace-memory.ts` with
strict model inputs, runtime-owned workspace scoping, proposal, exact/tag
search, read, promote, stale, and retire APIs. Add model-facing
`memory_*` tools and dynamic instructions that inject a compact active memory
slice with explicit trust-boundary wording. Source text stays on
provenance rows, separate from model-generated statements and summaries.

User effect: maintainers can capture compact reusable docs concepts, surfaces,
style rules, workflow rules, ownership, and decisions without turning Slack or
Linear discussion into unsupported docs truth. Memories must be promoted before
active use, can become stale or retired, and can be searched or inspected with
provenance.

Behavior verification: run `pnpm check`. Behaviorally, model-supplied workspace
ids should be rejected, proposed memories should not appear in default active
search, promoted memories should search by exact text or tag, expired/stale
memories should be filtered unless requested, retired memories should disappear
from default search, dynamic instructions should label memory as untrusted
context, and deployed runtime without `DOCS_AGENT_DATABASE_URL` should fail
memory workflows visibly.
