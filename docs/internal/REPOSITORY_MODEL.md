# Repository Model

The agent works from one required **working documentation repository**, optional
read-only **watched repositories**, and zero or more external evidence sources.
The working documentation repository is the only mutable target. Everything else
is evidence for the documentation impact report or for a durable docs signal that
may later trigger verification and patch work.

## Working Documentation Repository

The working documentation repository is a GitHub-hosted documentation repository
provided by URL. A ref and docs root may be provided, but they are not required:
the ref defaults to `main`, and the docs root is detected after the repository
is cloned or materialized into the Eve sandbox at `/workspace/working-docs`.

The repository input contract captures:

- `source.type`: `github-url`.
- `source.url`: `https://github.com/<owner>/<repo>[.git]`.
- `ref`: optional branch, tag, or commit to inspect. Defaults to `main`.
- `docsRoot`: optional repository-relative docs root, such as `docs` or `.`. If
  omitted, the workflow detects a Docusaurus-style docs root from the sandbox
  checkout.
- `sandboxPath`: `/workspace/working-docs`.
- `accessMode`: `sandbox-write`.
- `allowedActions`: clone, read, search, patch, run checks, and export diff.
  Approved GitHub writeback adds `publish-pr`.
- `provenanceLabel`: `working-documentation-repository`.

The active working repository configuration is persisted as versioned setup
state in the app-owned Drizzle/libSQL database. Local development defaults to a
SQLite-compatible file at `.docs-agent/docs-agent.sqlite`; deployed runtimes must
provide `DOCS_AGENT_DATABASE_URL` and fail visibly when setup persistence is not
available. Calling `configure_working_repository` validates the repository input
through the configured app-scoped GitHub connector and saves only the reusable
repository setup. It also records the full per-session repository input in Eve
state so the next workflow call can use attached context without re-asking for
setup. It does not materialize the sandbox checkout unless explicitly requested.
One-off scenario context is not persisted as workspace setup.

At the start of each turn, dynamic Eve instructions read setup state and guide
the model into setup mode when required fields are missing or stale. When setup
already exists, `prepare_configured_working_repository` and the docs workflow
can materialize the persisted repository without asking the user for the same
GitHub URL again.

Host local paths are not supported as repository sources for the main workflow.
Local development and production use the same sandbox-first contract: GitHub URL
to Eve sandbox to report, diff artifact, and approved GitHub writeback.

## Approved GitHub Writeback

Writeback is available only for the configured working documentation repository.
The model-facing surface is the authored `publish_working_repository_pr` tool,
not generated GitHub API tools, raw sandbox git commands, or a context/source
repository operation.

The publish tool requires approval on every call. After approval, runtime code
uses an app-scoped Vercel Connect GitHub credential to create a branch, commit
the prepared sandbox diff, and open a draft PR. The credential stays in the
trusted runtime: it is not passed into the sandbox, model context, prompt, or
durable report artifact.

The tool publishes only the last prepared workflow diff. It refuses to publish
when there is no diff, checks failed or were not recorded, the sandbox diff no
longer matches the workflow result, the base branch moved, the publish branch
already exists, or the working tree contains staged, untracked, deleted, renamed,
copied, binary, or unsupported-mode changes.

GitHub repository validation and approved writeback use the same app-scoped
connector path. The workspace must have a configured working documentation
repository, the `publish-pr` repository action, and an app-scoped GitHub
connector. Before publishing, the runtime preflights the connector and GitHub App
installation for the configured repository. The Connect token request targets the
repository's GitHub App installation instead of asking for a generic app token.
Failures are reported as setup problems such as missing connector, connector
unavailable to this runtime, app not installed, repository not granted, or
insufficient GitHub permissions. If Eve needs an authorization challenge to
resolve the connector, that challenge is surfaced by the normal Eve/Vercel
Connect flow instead of being replaced by a fake URL.

## Sandbox Boundary

`apps/agent/agent/sandbox.ts` uses `microsandbox()` by default for local development and
uses `vercel()` when deployed on Vercel. Set `EVE_SANDBOX_BACKEND=vercel` during
local development to test against hosted Vercel Sandbox explicitly.

Both supported backends enforce the same initial network policy: GitHub and
GitHub content domains needed for repository materialization are allowed, and
the npm registry domains needed for locked dependency installation are allowed
so sandboxed docs checks can run. Provider and arbitrary internet egress remain
out of scope until a later workflow explicitly requires them.

Materialization may reuse an existing sandbox checkout when the remote matches
the requested working repository. It may also restore a matching sandbox-local
repository cache after a prior materialization wrote a ready marker. Reuse still
resets tracked changes and cleans untracked non-ignored files before analysis.
If neither cache is available, or the checkout belongs to another repository,
the workflow clones a fresh copy and promotes the resolved checkout into the
repository cache for future sessions.

Dependency installation uses a sandbox-local cache marker outside the working
repository. A cached install is valid only when `node_modules` exists, the
`pnpm-lock.yaml` hash matches, and the prior install marker records a passed
locked install for the same repository and ref. Repository checkout behavior
stays repository-generic: it only restores a cache if a matching marker exists.
Required checks such as git diff checks still run when the scenario requires
them.

If the sandbox cannot be created, the repository cannot be cloned, refreshed, or
materialized, or the input uses an unsupported source such as a host local path,
the workflow must fail visibly. It must not fall back to a local checkout, stub
repository, fake diff, or false-success report.

## Context Repositories

Context repositories are the broad future abstraction for additional repository
evidence. The current implementation uses the narrower watched repository
contract below.

## Watched Repositories

Watched repositories are optional GitHub-hosted source repositories configured
alongside the working documentation repository. They are cloned or materialized
into the sandbox with `sandbox-read` access. They can support clone, read,
search, diff inspection, and explicitly safe read-only checks, but they cannot
receive patches, branches, commits, draft PRs, write credentials, or other write
actions.

Watched repository provenance must be labeled separately from working
documentation repository provenance. The configured provenance label uses
`watched-repository:<owner>/<repo>`.

The first watched-repository workflow is prompt-triggered release scanning:

1. Load the configured working documentation repository and watched repository
   list from setup state.
2. Use GitHub release signals for discovery. Prefer app-scoped GitHub access
   when the watched repository is granted to the configured connector. If app
   access is unavailable or ungranted, explicitly use public GitHub API access
   for public watched repositories and record that access mode in provenance.
   If neither path can read the repository, fail visibly.
3. Resolve each release candidate to its tag/ref.
4. Materialize the watched repository into its configured read-only sandbox
   path, such as `/workspace/watched/saleor-core`. Use brokered GitHub App
   credentials for granted repositories; use unauthenticated clone for public
   repositories.
5. Search watched source files through read-only policy checks to verify
   candidate terms.
6. Search the working documentation repository for matching docs evidence.
7. Emit a documentation impact report with separate GitHub signal,
   watched-repository, and working-documentation-repository evidence.
8. Do not write to watched repositories. Any later docs patch or draft PR must
   target only the working documentation repository.

## External Context

External context is structured non-repository evidence. It is not a loose plain
text blob. It preserves source shape, provenance, timestamps, authors, links,
and relationships.

Supported provider-neutral shapes are:

- `communication-thread`
- `issue-tracker-item`
- `decision-record`
- `release-note`
- `customer-report`

Provider-specific systems can map into these shapes later without becoming
first-class assumptions in the repository model.

## Docs Signals And Workflow State

A docs signal is a provider-neutral work item created from external context,
watched-repository evidence, or a future scheduled scan. It represents a
potential documentation-maintenance concern, not necessarily a patch request.

A signal should preserve:

- source kind, such as Slack thread, Linear issue, watched release, or scheduled
  scan result;
- provider identifiers and permalinks;
- authors, timestamps, and capture time;
- extracted claims or behavior changes;
- likely affected docs concepts, pages, or product surfaces when known;
- related source repositories, releases, PRs, Linear issues, or Slack threads;
- uncertainty and missing evidence;
- workflow status, such as captured, needs maintainer answer, needs source
  evidence, verification skipped, docs verified, patch failed, patch prepared,
  draft PR opened, closed as already covered, or closed as not docs-relevant.

Signals are not a second writable repository target. They are the work queue and
memory that lets the agent join context over time: a Slack thread may capture
intent, a Linear issue may clarify scope, a watched release may provide source
evidence, and the working documentation repository verification may decide
whether the current docs are already covered or stale.

Signal and workflow state is persisted in one agent-owned database, not in the
working documentation repository, watched repositories, Slack, Linear, GitHub
issues/comments, Eve session state, or repo-local JSON. ADR-0001 chooses a
Drizzle-backed SQLite-compatible storage boundary: local development can use a
SQLite file through `@libsql/client`, while deployed runtimes can use the same
Drizzle schema against libSQL, with Turso Cloud as the likely first managed
backend when hosted persistence is needed.

That database belongs to one Paige agent. The agent runtime and its paired
server-side operator app use the same typed services and may share the
database-scoped credential. Another Paige agent must use another database and
credential. Browser input, provider payloads, model-facing tools,
`workspace_id`, and `tenant_id` never select a database. See the
[architecture contract](../ARCHITECTURE.md) and
[ADR-0005](./adr/0005-one-database-per-agent.md).

Chat SDK operational state uses that same agent-owned database client and
deployment configuration, but remains isolated in `chat_sdk_*` tables. The
app-owned state adapter persists thread subscriptions, token-owned leases,
TTL-backed key-value and list state, and FIFO debounce queues. Local and hosted
runtimes use the same contract. A missing or unhealthy required database is an
explicit failure; the adapter never substitutes process memory. SQLite write
operations are ordered within a process and retry only bounded `SQLITE_BUSY`
contention, while database constraints and short transactions preserve
correctness across instances.

## Policy-Bound Watch State

A watch is product state, not repository configuration, an Eve session, or a
second workflow engine. Its durable record is split by responsibility:

- `policy_bound_watches` owns workspace scope, lifecycle, optimistic state
  revision, and the pointer to the approved effective revision;
- `watch_policy_revisions` owns immutable proposed policies and deterministic
  edit classifications;
- `watch_effective_revisions` owns immutable approved policy copies so admitted
  work stays bound to the revision it started with;
- `watch_lifecycle_events` owns append-only creation, approval, pause, resume,
  expiry, and deletion audit.

Deletion removes proposal and effective policy content but retains the watch
identity and lifecycle audit tombstone. Natural-language goal edits and
structured authority edits always create a new proposal. They do not mutate an
approved policy or change admission until the exact replacement is explicitly
approved.

All agent and web access goes through the shared control-plane exports. Those
services require ready database migrations, canonical workspace setup, and a
server-owned capability registry before they can create, approve, resume, list
as admission-ready, or return effective watch authority. Active policy is
revalidated on read. The readiness projection distinguishes unavailable,
invalid, proposed, paused, expired, active, and deleted state without returning
database locations, tokens, connector secrets, or raw policy validation input.
Store, setup, registry, schema, or policy failures stop visibly; there is no
in-memory watch, default active policy, or inferred authority fallback.

Slack enters Eve through `chatSdkChannel` and the Chat SDK Slack adapter at the
existing `/eve/v1/slack` route. Vercel Connect still resolves the app-scoped bot
token and verifies trigger-forwarded requests. The adapter admits explicit app
mentions and DMs through their existing participation mode. For ordinary public
or private channel messages, the verified adapter sends only workspace,
resource, and event-type metadata to the active-watch lookup before running the
separate thread-id subscription lookup. If neither an active effective watch nor
an enrolled thread admits the event, it is discarded before Chat SDK parses its
content or can run dedupe, history, queue, or Eve/model processing. A watch match
is bound to the exact effective revision and does not itself create a Chat SDK
conversation or Eve turn. Bot and self-authored messages, edits, deletes, and
unsupported subtypes are discarded even earlier. Accepted mentions create a separate
`slack_thread_presence` record and Chat SDK subscription for that thread. The
record preserves the Slack workspace, channel, root timestamp, continuation
token, inviter, activity, status, and expiry without becoming a docs signal.
Ordinary admitted messages refresh a seven-day inactivity window and resume the
same Eve thread; one-second durable burst debouncing combines short reply bursts
into one observer turn.

Accepted turns retain Slack actor auth, incremental context since Paige's last
reply, thread delivery, and HITL user identity. Followed-thread observer turns
answer direct continuations and useful documentation questions, may call
`capture_slack_docs_signal` for plausible documentation context, and emit an
internal `[[SILENT]]` marker for unrelated conversation. The Slack delivery
handler suppresses that marker. Exact dismissal phrases end presence and remove
the subscription; terminal docs-signal transitions resolve matching presence;
expired presence is rejected and its stale subscription removed before content
reaches Chat SDK. Merely following a thread does not create a docs signal.

Missing Slack context uses a narrower request-lifetime boundary. The Slack
adapter extracts an event's `action_token` into server-only memory for at most
30 seconds, removes it before Chat SDK sees or durably debounces the message,
and consumes it once for the matching Slack user. The model-facing
`retrieve_slack_context` tool requires a concrete context gap, allows one
`assistant.search.context` request with at most five results, and rejects
public-to-private widening before the API call. Slack remains the authority for
workspace membership, private-channel, MPIM, and DM consent and scopes.

Raw search hits pass only to a telemetry-disabled one-shot summarization call.
The Eve turn receives a short paraphrased summary, result count, and Slack
permalinks; it never receives the token or raw messages. Exact copied passages
are suppressed. The tool does not page, fetch ambient history, log results,
create signals, or write workspace memory. Search-derived discussion may guide
an answer or investigation but is not source, release, or repository evidence
for a public documentation claim. Missing authorization, permission or consent,
scopes, feature access, and rate limits return visible bounded failures.

Workspace setup state now lives in the same app-owned database boundary as the
future signal queue, but it remains a separate record from mutable signal
workflow state. It stores reusable repository setup and writeback configuration;
it does not store signal queue state, verification runs, workflow events, or
patch artifacts. Existing `.docs-agent/config.json` files are ignored; a missing
database setup row means the workspace must be configured from scratch.

The agent and authenticated web onboarding both use this canonical setup row.
The web flow first validates the working repository, requested ref, optional
docs root, GitHub App installation, repository grant, and writeback permissions;
failed checks never produce a ready setup. A successful save appends a full
setup snapshot to `workspace_setup_events` with the authenticated operator id
and normalized GitHub login. Watched repositories are reconstructed on the
server with sandbox-read access, the fixed read-only action set, and their
provenance label before persistence. The browser cannot turn one into a
writeback target.

The signal database should start small but support the near-term M3 workflows:

- one canonical workspace scope inside the current agent database; it is not a
  cross-agent tenant boundary;
- docs signals with status, extracted claim, uncertainty, priority, timestamps,
  and optional next action time;
- signal sources with provider ids, source kind, authors, timestamps, and
  permalinks;
- signal links for related repositories, releases, PRs, Linear issues, Slack
  threads, and other cross-source references;
- verification runs with sandbox refs, considered docs pages, outcome, report
  summary, and check status;
- workflow events as an append-only audit trail for status transitions,
  skipped-verification reasons, maintainer questions, patch preparation, draft
  PR handoff, and closure reasons;
- artifact references to diff, report, and check artifacts rather than large
  blobs stored directly on the signal row.
- a one-to-one substantial-work projection with Eve execution, conversation,
  milestone, artifact, idempotency, and optimistic-revision references.

The minimum query model should support provider dedupe, claim or release
dedupe, status-based work queue lookup, scheduled follow-up lookup, and audit or
run lookup by signal id.

The first queue implementation stores this state in dedicated Drizzle tables:
`docs_signals`, `docs_signal_sources`, `docs_signal_links`,
`docs_signal_artifacts`, `docs_signal_events`, and `docs_signal_owned_work`.
Runtime code owns workspace scoping and currently uses the default workspace id
inside the already selected agent database; model-facing tools do not accept a
workspace, tenant, or agent id, database URL, or database token. Source rows
keep raw provenance such as source text, provider ids, authors, and permalinks
separate from model-generated signal summaries and extracted claims.

The model-facing queue tools are deliberately small:

- `retrieve_slack_context`: during the active user-triggered Slack request,
  perform one bounded Real-time Search on the requesting user's effective
  access and return only a derived summary plus source permalinks. Raw results
  remain outside durable Eve, Chat SDK, signal, and memory state.
- `capture_slack_docs_signal`: map an explicit Slack mention or DM thread into
  `communication-thread` external context, capture or dedupe the signal, run
  shared decision/triage, and return Slack reply guidance without exposing raw
  source text in model output.
- `capture_linear_docs_signal`: map a Linear Agent Session issue into
  `issue-tracker-item` external context, capture or dedupe the signal, run
  shared decision/triage, and return Linear Agent Activity reply guidance
  without exposing raw source text in model output.
- `verify_docs_signal_current_docs`: inspect the configured working
  documentation repository for one signal, record verification evidence, and
  leave patch/writeback to later approved handoff.
- `prepare_docs_signal_patch`: turn an existing verified signal into a
  sandbox-local patch/check/diff result or an explicit no-patch/failed-check
  lifecycle event, while preserving original signal provenance.
- `create_docs_signal`: capture or dedupe a structured signal.
- `list_docs_signals`: list open or filtered signals by status/source kind.
- `get_docs_signal`: read one signal with provenance, links, artifacts, and
  lifecycle events.
- `update_docs_signal_lifecycle`: update status with a reason and optional
  workflow links or artifacts.

The generic queue tools do not add Slack, Linear, scheduled scan, patch, or
writeback behavior by themselves. Slack intake now calls the queue through
`capture_slack_docs_signal`, Linear intake calls the queue through
`capture_linear_docs_signal`, and signal verification uses
`verify_docs_signal_current_docs`. Patch handoff uses
`prepare_docs_signal_patch` and approved draft PR publishing remains isolated in
`publish_working_repository_pr`.

## Owned Documentation Work

Substantial documentation work extends its originating docs signal with one
provider-neutral owned-work record. The record keeps a stable work id, Eve
session id, starting and latest turn/run ids, originating conversation, intended
outcome, current status and revision, and references to the impact report,
editorial recommendation, content plan, draft, validation, approval, and
publication artifacts. A unique signal constraint makes start idempotent.

Eve remains the execution engine. One durable Eve turn can continue through all
reversible investigation, judgment, planning, authoring, revision, and validation
after the user leaves. The owned-work row is a domain projection and concurrency
boundary, not a scheduler or second workflow engine. Updates use optimistic
revisions and operation keys; completed Eve steps are replay-safe, corrections
serialize against the current revision, and a different session cannot silently
take over sandbox state.

`owned_docs_work` starts, inspects, records, parks, resumes, corrects, pauses,
abandons, or completes that work. Missing evidence and consequential decisions
park durably; a later answer resumes the same id and session. Unrecoverable
failure, explicit abandonment, completed draft, justified no-change, and blocked
outcomes are terminal and explicit. Publication remains a separate
`publish_working_repository_pr` approval.

Meaningful milestones return a concise channel update: acceptance, content plan,
changed approach, blocker, draft readiness, approval request, completion, or
abandonment. Routine reads, edits, retries, and successful checks return no
channel update while their events and typed artifacts remain visible on the
signal detail page. Quick questions and localized edits do not create owned work.

## Scheduled Follow-ups

`docs_follow_ups` stores a small checklist attached to existing docs signals:
one UTC due time, short reason, and pending/completed/cancelled status. The
earliest pending item is projected onto the signal's `nextActionAt`.

Eve discovers `daily-docs-follow-ups` at `0 9 * * *`, explicitly UTC. Its
task-mode prompt calls `process_due_docs_followups` once, then investigates the
bounded result through the normal signal workflow. Each UTC-date occurrence has
one unique `docs_follow_up_runs` record; pending-item claims are conditional, so
replays and concurrent dispatches cannot process an item twice. A run handles at
most 20 items.

Completed and failed run state, counts, timestamps, timezone, and bounded error
text are durable and visible through `docs_follow_up` schedule status. Due items
append signal events and remain ordinary evidence-first docs work. The schedule
cannot publish: task mode cannot park for approval, its prompt forbids writeback,
and `publish_working_repository_pr` retains the existing approval gate.

## Repository Docs Profile

The first real materialization of a working documentation repository performs a
bounded inspection of explicit instruction and style files, docs configuration,
navigation, validation scripts, and representative Markdown or MDX pages. It
stores a concise typed profile covering audiences, navigation, page types,
style rules, terminology, reusable components and examples, and validation
commands. Every observation carries confidence and repository source paths.

Profiles live in the app-owned database and are scoped by workspace, repository
URL, requested ref, resolved docs root, and resolved revision. The cache also
records a format version, source fingerprint, creation time, and seven-day
expiry. A matching fresh profile is reused; revision or source changes, expiry,
unsupported or corrupt data, maintainer correction, contradiction, and manual
refresh rebuild it. Generation failure stops visibly instead of returning an
empty successful profile.

`get_docs_profile` explains the base profile and loads up to five task-relevant
nearby pages on demand. Those examples enrich one task but are not promoted into
global rules. Repository observations remain separate from workspace memories:
a maintainer correction can be proposed through `memory_propose`, but neither
the profile builder nor retrieval tool silently activates memory.

## Editorial Recommendation

After current-docs verification, `editorial_recommendation` records Paige's
concise choice of no change, focused patch, new document, rewrite, restructure,
consolidation, removal, changelog-only, waiting for evidence, or asking a
maintainer. It names the reader problem, repository and docs-profile evidence,
up to three important alternatives, source evidence, relevant workspace-memory
references, and remaining uncertainty or blockers. This is the immediate
handoff from docs-impact judgment, not a second planning document.

The recommendation is model judgment. Code validates the typed handoff and
safety boundaries; it does not score documentation quality. A requested format
can be rejected when repository evidence shows duplication or a broken reader
path. If a maintainer explicitly reaffirms a consequential intervention after
seeing the tradeoff, the recommendation must follow it unless that would create
an unsupported public claim or cross an existing safety boundary. Routine style
preferences do not warrant pushback.

Recommendations are living Eve session state with a stable id, revision, prior
docs-impact reference, and task or docs-signal references. `proceed` choices can
enter reversible authoring directly, `plan-required` choices must create a
content plan, `complete-no-change` stops without a draft, and `blocked` stops
before mutation. Associated drafts record the recommendation id and revision.

## Content Planning

The docs-impact decision establishes whether documentation work is warranted,
and the editorial recommendation chooses the intervention. For substantial
work, `content_plan` then records what Paige intends to write:
the reader and desired outcome, content type and placement, affected surfaces,
outline, evidence, examples, assets, unresolved decisions, validation, and
definition of done. The plan points back to the prior impact decision instead
of repeating it.

Content plans are living Eve session state. They carry task or docs-signal
references, a stable id, and a revision number; an associated authoring draft
records that id and revision. Creating or revising a ready plan returns a
concise progress update and proceeds directly into reversible sandbox work.
There is no planning approval gate.

Missing evidence or an unresolved consequential decision marks the plan
blocked and stops authoring before mutation. Obvious substantial operations—new
files, coordinated surfaces, moves, copies, removals, or large replacements—are
also rejected when no matching ready plan exists. A single localized edit to
an existing file skips the planning artifact.

## Authoring Workspace

`authoring_workspace` is the policy-aware editing surface for one complete draft
inside the materialized working documentation repository. A single batch can
write full text files or base64 binary assets, copy, move, and delete files
anywhere under the repository root. It is intentionally not limited to
`docsRoot`: navigation, configuration, redirects, examples, and repository-owned
assets are valid draft surfaces. Repository-relative path validation prevents
escape; watched and context repositories never enter this write path.

The sandbox working tree keeps the draft reversible across turns. Draft state
records the resolved base revision, task references, associated editorial
recommendation and content-plan ids and revisions when present, operation count,
changed files, checks, complete binary-aware diff, and preparation time. Inspect reads
the current draft, prepare runs selected repository checks and freezes the
reviewable result for writeback, and abandon restores the sandbox checkout to
its base without touching GitHub.

New files use intent-to-add only so they appear in an unstaged review diff.
GitHub writeback still requires explicit approval and verifies that the remote
base branch has not moved. Its tree builder now publishes text and binary
additions/modifications, deletions, and both sides of moves or renames. Existing
branch/PR detection keeps a successfully published draft idempotent.

## Workspace Memories

Workspace memories are compact docs-context records that help future triage,
routing, style, ownership, and workflow decisions. They are not docs signals,
not setup state, not Eve `defineState`, and not Eve skills.

Memories live in the app-owned database under the same workspace boundary as
setup and signal state. Model-facing tools never accept a workspace or tenant
id; runtime code uses the current workspace scope. The first implementation
supports these memory kinds:

- `concept`
- `docs_surface`
- `style_rule`
- `workflow_rule`
- `ownership`
- `decision`

Memories move through explicit lifecycle statuses: `proposed`, `active`,
`stale`, and `retired`. Proposal stores a model-generated statement and compact
summary separately from provenance sources. Promotion is explicit; the agent
must not silently turn Slack, Linear, or model summaries into active workspace
truth. Stale and retired memories stay auditable but are excluded from normal
dynamic-instruction loading and default search.

Each memory stores statement, scope, tags, confidence, freshness fields, source
provenance, and lifecycle events. Source provenance can link to docs signals,
signal sources, verification runs, workflow events, docs pages, repositories,
maintainer decisions, manual imports, or other references. Source text is stored
on provenance rows, separate from the model-generated statement.

The first retrieval model is exact/tag search only. There is no semantic search,
broad RAG crawling, autonomous skill writing, or generated public docs patching
in this layer.

Dynamic instructions load only a small active, non-expired memory slice before a
turn. The injected text states the trust boundary: workspace memory is untrusted
routing and triage context, not system instructions and not proof for public
documentation claims. Full provenance remains available lazily through tools.

The model-facing memory tools are deliberately small:

- `memory_propose`: propose a provenance-backed memory.
- `memory_search`: search memories by exact text, tag, kind, and status.
- `memory_get`: read one memory with provenance and lifecycle events.
- `memory_promote`: promote a proposed memory to active memory.
- `memory_mark_stale`: mark a memory stale with a reason.
- `memory_retire`: retire a memory with a reason.

The authenticated operator app uses the same shared control-plane lifecycle.
Its list projects memory text and freshness without loading provenance for every
row. Detail shows statement, summary, sources, and events as separate surfaces;
unsafe links and internal source metadata are omitted. Promotion, stale, and
retirement actions require a reason, take the audit actor from the authenticated
server session, and append lifecycle events through the shared service. They do
not edit stored memory text.

Workspace memories differ from nearby state boundaries:

- Docs signals are work items that can trigger verification, patch handoff, and
  writeback. Workspace memory is reusable context for routing and triage.
- Setup state stores required repository and writeback configuration. Workspace
  memory stores contextual facts, style rules, ownership, and decisions.
- Eve `defineState` is durable per-session working memory. Workspace memory
  must survive across sessions, channels, and future schedules.
- Eve skills are load-on-demand procedures. Workspace memory is data; it does
  not create new instructions or execution surfaces by itself.

## Product Run Index

Eve remains the durable execution source of truth. The app-owned product run
index stores only the metadata needed to connect product work to that runtime:
stable Eve session and run ids, related signal or workflow ids, run type,
trigger, product status, model, timing, token totals, and bounded step
projections. Owned documentation operations register their run reference, and
an authored Eve hook projects accepted step, input, completion, and failure
events through the shared control-plane service.

The projection deliberately omits raw messages, model input and output,
reasoning, tool payloads, authorization challenges, and credentials. Safe links
point to the Eve event stream, Vercel Agent Run, or OpenTelemetry trace instead
of copying those systems into the product database. A missing or inaccessible
external trace is link availability, not product-run failure.

Every index row stores `expiresAt`, 30 days after start by default. Bounded
cleanup deletes expired rows; database cascades delete their product-level
steps and trace links. Eve, Vercel, and OpenTelemetry own their separate
retention policies. This index does not implement workflow replay,
cancellation, or a tracing backend.

## Approval Inbox

Tool approval remains an Eve runtime policy. When Eve emits an approval-shaped
`input.requested` event, an authored hook creates a minimal app projection tied
to the product run and signal. It stores the request and call ids, safe action
summary, destination, requester, expiry, safe publish input, and the opaque
resume handle required by Eve. That handle is server-only and is removed after
a successful decision; it never enters operator projections or audit events.

The authenticated operator service re-reads the durable event stream before
every decision. It rejects requests that are missing, expired, stale, or
already answered, then locks the request and idempotency key before posting an
`approve` or `deny` `inputResponses` answer to the original session. A failed
resume restores the request to pending and appends a credential-free failed
audit attempt. A successful submission clears the resume handle and records the
authenticated operator plus reason.

The inbox does not call `publish_working_repository_pr`, bypass `always()`, or
manufacture approval state. Slack, Linear, terminal, and other channel-native
responses continue to use Eve's same pending request contract.

## Validation Results

The app-owned validation index stores bounded assurance summaries, not a copy
of Eve execution. Runs carry a stable id, suite, target, runtime identity,
timing, redaction version, safe artifact references, expiry, and an explicit
kind: `live-eval` or `deterministic-validation`. Cases carry stable ids, one of
missing, skipped, flaky, failed, or passed, safe assertion-kind summaries, and
an optional redacted failure summary.

The Eve reporter consumes structured run and case lifecycle callbacks. It does
not parse CLI text, and reporter persistence failures remain command failures.
Prompts, outputs, private source context, reasoning, event streams, tool
payloads, credentials, assertion arguments, and free-form assertion labels are
not projected. Duplicate delivery updates the same run and case identity.
Runs expire after 30 days and a bounded service deletes them with their cases.
External reporters and Eve artifacts keep their own independent contracts and
retention.

The authenticated assurance read service projects list and detail records for
the operator app. A comparison baseline must be earlier and match the current
suite, validation kind, and target class. Case comparison treats removed
assertions, gate-to-soft changes, and lower thresholds as weakened proof; it
does not rewrite the current or baseline record. The route and browser import
only this typed projection, never the database client, tables, or Eve reporter.

## Docs Impact Decision Model

Paige uses a shared decision contract for signal triage, watched-release
findings, scenario workflows, and future Slack/Linear intake. The shared
decision record carries:

- decision;
- reason;
- evidence;
- missing evidence;
- current-docs verification state;
- recommended next action;
- uncertainty.

The shared decision values are:

- `not-docs-relevant`: no plausible public documentation impact.
- `needs-maintainer-answer`: the signal is ambiguous and needs a human answer.
- `needs-source-evidence`: intent exists, but source or release evidence is
  missing.
- `needs-docs-verification`: source-backed signal should inspect current docs.
- `verification-skipped`: current-docs inspection was not needed, with a
  concrete reason.
- `already-covered`: current docs were verified and already cover the signal.
- `likely-stale`: current docs were verified and appear stale or incomplete.
- `docs-patch-recommended`: a patch should be prepared through the working docs
  repository flow.
- `changelog-only`: the right output is release-note or changelog-shaped rather
  than a docs page patch.

Substantive product, API, release, or behavior signals default toward
`needs-docs-verification` when source or release evidence exists. Slack, Linear,
or other discussion context alone should produce `needs-source-evidence` when it
would otherwise become an unsupported public docs claim. Trivial, internal-only,
or noisy signals can skip repository inspection only through
`verification-skipped` with an explicit reason.

The older repository-scenario decisions remain as compatibility output for the
current evals and writeback path: `docs-patch` maps to
`docs-patch-recommended`, `no-docs-change` maps to `already-covered`,
`changelog-only` stays `changelog-only`, and `ask-maintainer` maps to
`needs-maintainer-answer`.

Persistence failures must fail visibly. If the database is missing, unavailable,
corrupt, or behind the expected schema, the app should refuse signal capture,
queue processing, verification handoff, and status mutation instead of dropping
or partially recording work. A one-off answer can still be given from provided
context when useful, but the agent must say that durable signal capture is not
available.

## Example Input

```ts
{
  workingDocumentationRepository: {
    source: {
      type: "github-url",
      url: "https://github.com/org/docs-repo.git",
    },
  },
  watchedRepositories: [
    {
      id: "product-core",
      name: "Product Core",
      description: "Primary product and API repository documented by this docs site.",
      importance: "critical",
      source: {
        type: "github-url",
        url: "https://github.com/org/product-core.git",
      },
      defaultRef: "main",
      sandboxPath: "/workspace/watched/product-core",
      accessMode: "sandbox-read",
      allowedActions: ["clone", "read", "search", "inspect-diff", "run-readonly-checks"],
      pathFilters: ["src/**", "CHANGELOG.md"],
      signals: ["releases"],
      provenanceLabel: "watched-repository:org/product-core",
    },
  ],
  contextRepositories: [],
  externalContext: [],
}
```

The TypeScript and Zod contract lives in `apps/agent/agent/lib/repository-contract.ts`.
