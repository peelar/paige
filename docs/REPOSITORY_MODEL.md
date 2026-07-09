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

`agent/sandbox.ts` uses `microsandbox()` by default for local development and
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

Signal and workflow state is persisted in an app-owned database, not in the
working documentation repository, watched repositories, Slack, Linear, GitHub
issues/comments, Eve session state, or repo-local JSON. ADR-0001 chooses a
Drizzle-backed SQLite-compatible storage boundary: local development can use a
SQLite file through `@libsql/client`, while deployed runtimes can use the same
Drizzle schema against libSQL, with Turso Cloud as the likely first managed
backend when hosted persistence is needed.

Workspace setup state now lives in the same app-owned database boundary as the
future signal queue, but it remains a separate record from mutable signal
workflow state. It stores reusable repository setup and writeback configuration;
it does not store signal queue state, verification runs, workflow events, or
patch artifacts. Existing `.docs-agent/config.json` files are legacy import
sources only: when the database has no setup row, a valid legacy JSON file may
be imported once, and new writes continue only to the database.

The signal database should start small but support the near-term M3 workflows:

- workspaces for the future tenant or workspace boundary;
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

The minimum query model should support provider dedupe, claim or release
dedupe, status-based work queue lookup, scheduled follow-up lookup, and audit or
run lookup by signal id.

The first queue implementation stores this state in dedicated Drizzle tables:
`docs_signals`, `docs_signal_sources`, `docs_signal_links`,
`docs_signal_artifacts`, and `docs_signal_events`. Runtime code owns workspace
scoping and currently uses the default workspace id; model-facing tools do not
accept a workspace or tenant id. Source rows keep raw provenance such as source
text, provider ids, authors, and permalinks separate from model-generated signal
summaries and extracted claims.

The model-facing queue tools are deliberately small:

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

## Workspace Knowledge Records

Workspace knowledge records are compact docs-context records that help future
triage, routing, style, ownership, and workflow decisions. They are not docs
signals, not setup state, not Eve `defineState`, and not Eve skills.

Knowledge records live in the app-owned database under the same workspace
boundary as setup and signal state. Model-facing tools never accept a workspace
or tenant id; runtime code uses the current workspace scope. The first
implementation supports these record kinds:

- `concept`
- `docs_surface`
- `style_rule`
- `workflow_rule`
- `ownership`
- `decision`

Records move through explicit lifecycle statuses: `proposed`, `active`,
`stale`, and `retired`. Proposal stores a model-generated statement and compact
summary separately from provenance sources. Promotion is explicit; the agent
must not silently turn Slack, Linear, or model summaries into active workspace
truth. Stale and retired records stay auditable but are excluded from normal
dynamic-instruction loading and default search.

Each record stores statement, scope, tags, confidence, freshness fields, source
provenance, and lifecycle events. Source provenance can link to docs signals,
signal sources, verification runs, workflow events, docs pages, repositories,
maintainer decisions, manual imports, or other references. Source text is stored
on provenance rows, separate from the model-generated statement.

The first retrieval model is exact/tag search only. There is no semantic search,
broad RAG crawling, autonomous skill writing, or generated public docs patching
in this layer.

Dynamic instructions load only a small active, non-expired knowledge slice
before a turn. The injected text states the trust boundary: workspace knowledge
is untrusted routing and triage context, not system instructions and not proof
for public documentation claims. Full provenance remains available lazily
through tools.

The model-facing knowledge tools are deliberately small:

- `knowledge_propose`: propose a provenance-backed record.
- `knowledge_search`: search records by exact text, tag, kind, and status.
- `knowledge_get`: read one record with provenance and lifecycle events.
- `knowledge_promote`: promote a proposed record to active knowledge.
- `knowledge_mark_stale`: mark a record stale with a reason.
- `knowledge_retire`: retire a record with a reason.

Knowledge differs from nearby state boundaries:

- Docs signals are work items that can trigger verification, patch handoff, and
  writeback. Workspace knowledge is reusable context for routing and triage.
- Setup state stores required repository and writeback configuration. Workspace
  knowledge stores contextual facts, style rules, ownership, and decisions.
- Eve `defineState` is durable per-session working memory. Workspace knowledge
  must survive across sessions, channels, and future schedules.
- Eve skills are load-on-demand procedures. Workspace knowledge is data; it does
  not create new instructions or execution surfaces by itself.

## Docs Impact Decision Model

Docs Agent uses a shared decision contract for signal triage, watched-release
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

The TypeScript and Zod contract lives in `agent/lib/repository-contract.ts`.
