# Paige Workflows

Paige work starts from a docs signal and ends with a report, a lifecycle
state change, a patch handoff, or a maintainer question. Current-docs
verification is one capability inside these workflows, not the whole product.

Stable capability-family identifiers, authority semantics, and the exhaustive
current-to-target tool migration live in
[`CAPABILITIES.md`](./CAPABILITIES.md). Workflows and skills compose those
capabilities; they do not define new authority or persist current tool names as
policy.

## Workflow Model

### Mentioned In Context

A user brings the agent into a Slack thread or Linear Agent Session. The channel
captures the thread or issue as structured source provenance, creates or dedupes
a docs signal, and runs decision/triage. The agent replies with what it captured,
what evidence is missing, whether current docs were verified, and the next
action.

An accepted Slack mention also establishes scoped thread presence independently
of signal state. Later human replies in that thread continue the same Eve
session without another mention. Paige responds to direct continuations and
answerable documentation questions, captures plausible docs context through the
normal Slack intake tool, and stays silent for unrelated conversation. Presence
ends on an explicit dismissal, a terminal lifecycle transition for the matching
docs signal, or seven days of inactivity.

### Periodic Scan

A user or future schedule asks the agent to check configured sources such as
watched repositories, release feeds, or channel/project scopes. The scan creates
or updates docs signals. It does not write docs directly.

### Policy-Bound Proactive Attention

An operator may propose a bounded watch goal and structured source, context,
capability, retention, budget, delivery, and expiry policy. Proposal preview,
explicit approval, pause, resume, expiry, deletion, and replacement approval are
shared control-plane operations; they are not model-authored workflow steps.
Only the immutable effective revision can later admit work. Editing a goal or
authority creates another proposal while existing and already admitted work
remain bound to their original effective revision.

Before any watch can become usable, the service rechecks database migrations,
canonical workspace setup, the server-owned capability registry, lifecycle,
expiry, and the exact effective policy. Failure reports unavailable or invalid
readiness and stops. It does not create an Eve turn, infer default authority, or
fall back to process memory. The verified Slack adapter now resolves active
watches from metadata-only workspace, resource, and event-type scope before
content parsing or Chat SDK state can widen admission. A match carries the exact
effective revision. Supported original human messages normalize into the
provider-neutral ephemeral envelope and claim a durable, content-free
occurrence checkpoint before any later execution. Watch-goal execution remains
a later workflow slice.

### Initiative Or Project Participation

The agent follows a product effort over time by joining new Slack, Linear,
release, watched-repository, or maintainer evidence to an existing signal. The
signal remains the durable work item; individual messages are provenance.

### Release Readiness

The agent checks release-bound signals before or during a release. It asks
whether public behavior changed, whether source or release evidence exists, and
whether the current working docs already cover the change.

### Current-Docs Verification

The agent materializes the configured working documentation repository in the
sandbox and verifies current docs for one signal or scenario. This capability
can return already-covered, likely-stale, patch-recommended, changelog-only, or
ask-maintainer decisions. It does not publish.

### Patch Handoff

When verification supports a docs patch, the agent prepares a minimal patch,
runs checks, exports a diff, and records the signal lifecycle state. Draft PR
publishing remains a separate explicit approval through
`publish_working_repository_pr`.

## Runtime Boundaries

The operator app has a separate inbound identity boundary. Better Auth verifies
the GitHub callback and web cookie, then maps the approved account to an
app-owned operator principal. That cookie authorizes only Next.js pages and
server operations. A future cross-origin call into Eve must use a short-lived
server credential and an Eve route `AuthFn`; it cannot rely on the browser
cookie or silently inherit web authentication.

| Boundary | Owns | Current implementation | Must not do |
| --- | --- | --- | --- |
| Connector installation | Make each app-scoped provider reachable without hiding provider consent. | Authenticated Status-page stages over server-side Connect token checks, provider API checks, repository-targeted GitHub preflight, and connector-bound Slack or Linear inbound receipts. | Install silently, treat token reachability as trigger proof, expose credentials or connector ids, or continue headless after a provider requires human consent. |
| Workspace-memory review | Govern reusable routing and triage context without turning it into public evidence. | Authenticated list/detail projections plus shared `promoteWorkspaceMemory`, `markWorkspaceMemoryStale`, and `retireWorkspaceMemory` transitions with operator-supplied reasons and server-owned audit actors. | Edit memory rows or text directly, accept a browser-supplied actor, merge provenance into model text, or use memory as proof for public docs claims. |
| Product run index | Connect product operations to durable Eve and external traces. | Shared `createProductRun` and safe event projection, stable session/run ids, 30-day metadata retention, and authenticated Runs list/detail views with links to deeper traces. | Copy messages, reasoning, model output, tool payloads, or credentials; make inaccessible traces look like failed product work; add replay, cancellation, or another tracing backend. |
| Approval inbox | Find approval-gated side effects across channels and answer the original Eve request once. | Safe `input.requested` projection, authenticated list/detail, durable-stream recheck, request lock plus idempotency key, structured `inputResponses`, and credential-free decision audit. | Execute the tool in the web app, bypass `always()`, accept a browser-supplied actor, answer stale or expired requests, or disable channel-native approval. |
| Validation result recording and assurance | Give the control plane a durable assurance source and a read-only regression view without treating console or workflow internals as an API. | Typed shared run/case write and read services, structured Eve reporter callbacks, explicit live-eval versus deterministic-validation kinds, redacted summaries, stable ids, compatible earlier-baseline comparison, and 30-day bounded cleanup. | Parse CLI output, store prompts, outputs, context, reasoning, event streams, tool payloads, or credentials; weaken assertions, compare incompatible runs, run arbitrary commands from the browser, or hide persistence failures. |
| Behavior settings | Let an operator tune Paige's voice and Slack participation without turning settings into an authority or prompt editor. | Strict personality and participation fields, server-owned audit actors, append-only settings events, non-default dynamic instruction modifiers, pre-Chat SDK mention and DM admission, and bounded followed-thread continuation. | Accept raw prompt text, edit permanent evidence or safety rules, widen mutation or publishing authority, accept a browser-supplied actor, or hide persistence failures. |
| Operator workspace setup | Validate and persist the one canonical workspace configuration with an authenticated audit actor. | Status-page preflight over the shared repository validator and GitHub writeback preflight, followed by a revalidated save to `workspace_setup` and an append-only `workspace_setup_events` snapshot. | Persist before checks pass, create provider installations, widen watched repositories beyond read-only actions, or fork agent and web setup state. |
| Policy-bound watch governance | Persist bounded proactive-attention authority as immutable proposals and effective revisions with audited lifecycle. | Shared create, preview, approval, edit classification, pause, resume, expiry, deletion, effective-revision read, and secret-safe readiness services over the agent-owned database, canonical setup, and server-owned capability registry. | Treat an unapproved proposal as active, infer missing authority, expose tables or credentials, accept browser-selected scope, or continue when storage, setup, registry, policy, or lifecycle state is invalid. |
| Slack watch admission | Reject ambient Slack traffic before content parsing and bind admitted events to approved authority. | Verified-webhook metadata lookup by agent workspace, Slack workspace, channel, event type, lifecycle, expiry, and exact effective revision; original human messages then reduce to an ephemeral provider-neutral envelope with a post-admission permalink; mention, DM, and followed-thread admission remain separate. | Send rejected content to Chat SDK, queues, Eve, or the model; admit bots, self output, edits, deletes, or unsupported subtypes; leak provider payloads; infer provider authorization; admit paused or expired policy; create a signal or memory during normalization. |
| Watch occurrence checkpoint | Claim an admitted observation once across provider retries, concurrent delivery, and process restarts. | Deterministic key over workspace, effective revision, provider resource, and provider event occurrence; first-writer-wins insert; explicit bounded compare-and-set failure retry. | Persist observation text, prompts, secrets, permalinks, or actors; silently reset a failed claim; dispatch an existing claim again. |
| Slack thread presence | Admit only invited thread replies and preserve conversational continuity. | Separate `slack_thread_presence` state plus Chat SDK subscriptions, one-second burst debounce, silent observer turns, dismissal, signal-resolution cleanup, and seven-day inactivity expiry. | Persist or model-process unenrolled channel traffic, create signals from ordinary chatter, or widen participation beyond the invited thread. |
| Slack context retrieval | Fill one concrete context gap during the current Slack user's interaction. | Request-scoped `action_token`, one `assistant.search.context` call, up to five results, ephemeral summarization, and permalink-only citations through `retrieve_slack_context`. | Search ambiently, page automatically, expose tokens or raw hits to Eve state, retain results, or treat Slack discussion as verified public evidence. |
| Signal intake | Convert provider context into a docs signal with provenance. | `capture_slack_docs_signal`, `capture_linear_docs_signal`; `create_docs_signal`, `list_docs_signals`, `get_docs_signal`, `update_docs_signal_lifecycle`; watched scans also create source evidence. | Inspect or patch docs directly. |
| Owned execution | Keep one substantial task on its originating signal and Eve session through reversible work, human pauses, corrections, approval, and outcome. | `owned_docs_work`, the one-to-one `docs_signal_owned_work` projection, existing signal events/artifacts, and Eve's durable session/turn runtime. | Create a second workflow engine, duplicate work on resume, narrate routine activity, or bypass approval. |
| Scheduled follow-up | Revisit a bounded checklist of due signal work once per UTC daily occurrence. | `docs_follow_up`, `process_due_docs_followups`, `daily-docs-follow-ups`, and app-owned follow-up/run tables. | Scan broadly, process an occurrence twice, hide failures, or publish. |
| Decision and triage | Classify docs impact, missing evidence, verification need, and next action. | `planDocsImpactDecision` and the shared decision schemas. | Treat Slack or Linear context alone as proof for public docs claims. |
| Current-docs verification | Inspect the configured working documentation repository in the sandbox. | `verify_docs_signal_current_docs` for captured signals; existing scenario workflow in `run_docs_maintenance_scenario`. | Publish or write outside `/workspace/working-docs`. |
| Editorial recommendation | Choose the smallest intervention that solves the reader problem and explain evidence plus important alternatives. | `editorial_recommendation`, linked to current-docs evidence, docs profile, prior impact decision, and later draft. | Turn model judgment into a large rule engine, blindly follow a requested format, or debate routine style. |
| Content planning | Define the reader outcome, placement, scope, evidence, outline, validation, and done state for substantial work. | `content_plan`, linked to the prior docs-impact decision and authoring draft. | Duplicate impact judgment, gate a ready plan on approval, or require a plan for a localized patch. |
| Draft authoring | Create, revise, inspect, check, or abandon a complete working-repository draft. | `authoring_workspace`; `get_docs_profile` for conventions and nearby examples; `prepare_docs_signal_patch` for the existing signal-specific handoff. | Open a PR or write to watched/source repositories. |
| Writeback | Publish an approved draft PR to the working docs repository. | `publish_working_repository_pr`, optionally with `signalId` to mark the originating signal `draft-pr-opened`. | Run without explicit approval or target any repository except the configured working docs repo. |

## Tool Mapping

- `retrieve_slack_context`: search Slack's Real-time Search API once during an
  active user-triggered Slack turn when a named context gap blocks a useful
  answer; enforce the requesting user and invocation-surface permissions,
  reduce raw hits ephemerally, and return only a derived summary plus Slack
  permalinks. It is not a signal-intake or evidence-verification tool.
- `capture_slack_docs_signal`: convert an explicit Slack mention or DM thread
  into `communication-thread` external context, create or dedupe a Slack docs
  signal, run shared decision/triage, and return in-thread reply guidance.
- `capture_linear_docs_signal`: convert a delegated or prompted Linear Agent
  Session issue into `issue-tracker-item` external context, create or dedupe a
  Linear docs signal, run shared decision/triage, and return Agent Activity
  reply guidance.
- `owned_docs_work`: accept or resume substantial work on one docs signal,
  retain Eve session/run and conversation references, serialize corrections,
  record inspectable milestones and artifacts, park for human input, and finish
  with an explicit outcome. Quick inline work skips this tool.
- `docs_follow_up`: create, list, cancel, or inspect schedule status for the
  small signal-linked follow-up checklist.
- `process_due_docs_followups`: idempotently claim at most 20 due items for the
  current UTC daily occurrence and return them for normal investigation.
- `verify_docs_signal_current_docs`: materialize the configured working
  documentation repository for one signal, read likely docs pages, search likely
  docs terms, record a `docs-verified` lifecycle event, and return evidence
  without patching or publishing.
- `prepare_docs_signal_patch`: start from an existing `docs-verified` signal,
  reuse the configured working docs checkout, apply a minimal replacement
  through the policy-aware repository workflow, run checks, export a diff, save
  publishable workflow state, and mark the signal `patch-prepared`,
  `patch-failed`, or closed as no-patch.
- `content_plan`: create, revise, or inspect the living plan for substantial
  work, return a concise maintainer progress update, continue ready plans into
  sandbox authoring, and pause blocked plans before mutation.
- `editorial_recommendation`: create, revise, or inspect the concise
  reader-oriented intervention choice after current-docs verification; route
  substantial choices to `content_plan` and blockers to a visible pause.
- `create_docs_signal`: create or dedupe the durable work item.
- `list_docs_signals`: find active work by status and source kind.
- `get_docs_signal`: read source provenance, links, artifacts, and lifecycle
  events.
- `update_docs_signal_lifecycle`: record status changes and workflow evidence.
- `scan_watched_repositories`: periodic or on-demand read-only release scan.
- `run_docs_maintenance_scenario`: stays as the eval and scenario terminal
  workflow for now. It should not become the general channel tool name.
- `publish_working_repository_pr`: approval-gated writeback only.

## Scenario Outline

### Slack Mention With Source Evidence

1. A user mentions Paige in a Slack thread: "Does this API change need docs?"
2. Slack thread context is captured as a `slack-thread` signal source.
3. `capture_slack_docs_signal` maps the Slack thread into
   `communication-thread` external context and creates or dedupes the signal.
4. Decision/triage sees a customer-facing API claim and linked release evidence.
5. The shared decision is `needs-docs-verification`.
6. If workspace setup is ready, `verify_docs_signal_current_docs` materializes
   `/workspace/working-docs`, reads likely docs pages, and searches likely docs
   terms. If setup is missing or stale, the Slack reply says verification is
   blocked by setup instead of guessing repository details.
7. If docs already cover the behavior, the signal becomes `closed-already-covered`.
8. If docs are stale, `prepare_docs_signal_patch` prepares a diff in the
   working docs repo and marks the signal `patch-prepared`.
9. Draft PR publishing waits for explicit approval through
   `publish_working_repository_pr`. Passing the originating `signalId` marks
   the signal `draft-pr-opened` after a successful approved publish.

### Linear Issue Without Source Evidence

1. A Linear Agent Session asks Paige to check an issue.
2. `capture_linear_docs_signal` maps the issue and Agent Session context into
   `issue-tracker-item` external context and captures a `linear-issue` signal
   source.
3. The issue describes intended behavior but links no source, release, or
   maintainer-confirmed implementation evidence.
4. Decision/triage returns `needs-source-evidence`.
5. No sandbox verification runs yet.
6. The agent replies with the missing evidence and next action.
