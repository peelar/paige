# User Testing

The first user tests validate the sandboxed GitHub working-repository loop with
one public docs repository:

```text
https://github.com/peelar/saleor-docs.git
```

The canonical fixtures live in
`apps/agent/evals/scenarios/saleor-docs-user-test-scenarios.ts`. Copy-paste prompt files
for manual `/goal` runs live in `apps/agent/evals/scenarios/manual/`. Each fixture contains
the user prompt, working documentation repository input, attached issue/thread
context, expected outcome, expected touched files, forbidden touched files, and
checks.

## Scenarios

### Correct: Private Metadata Filtering

The user prompt suggests that Saleor now supports filtering by private metadata.
The attached issue, discussion, and release note confirm a public API behavior
change for authenticated staff users and apps with permission to access private
metadata.

Expected result:

- Clone, refresh, or reuse `peelar/saleor-docs` in `/workspace/working-docs`.
- Inspect `docs/api-usage/metadata.mdx`.
- Update only the existing "Filtering by metadata" section.
- Mention that public metadata filtering remains unchanged.
- Mention that private metadata filtering is permission-bound.
- Leave generated API reference files untouched.
- Run sandboxed git diff checks before exporting a diff.

### Incorrect: Sandbox Rate Limit False Alarm

The user prompt lightly suggests that Saleor Cloud sandbox rate limits changed
from 120 to 180 requests per minute. The attached issue and discussion say the
180 rpm value was internal-only and customer-facing sandbox limits remain 120
requests per minute.

Expected result:

- Clone, refresh, or reuse `peelar/saleor-docs` in `/workspace/working-docs`.
- Inspect `docs/api-usage/usage-limits.mdx`.
- Report that the current docs already say 120 requests/minute.
- Produce no patch and no diff.
- Do not push or open a draft PR.

## Manual `/goal` Loop

Use the scenario's rendered prompt as the `/goal` objective. The prompt sent to
the agent under test should include only:

- the user prompt;
- the working documentation repository URL and allowed actions;
- the attached context.

Do not include the expected outcome in the agent-under-test prompt. Use the
expected outcome only as the human review guide after the run completes.

Manual prompt files:

- `apps/agent/evals/scenarios/manual/saleor-docs-private-metadata-filtering.goal.md`
- `apps/agent/evals/scenarios/manual/saleor-docs-sandbox-rate-limit-false-alarm.goal.md`

For a passing run, the transcript should show:

- `configure_working_repository` called before docs maintenance starts;
- repository work happening inside `/workspace/working-docs` during the
  maintenance workflow;
- an impact report before any patch;
- evidence citations back to attached context and inspected docs pages;
- either a minimal diff for the correct scenario or an explicit no-change
  decision for the false alarm;
- check results or a visible check failure;
- no writeback without explicit approval.

To test first-run setup, delete `.docs-agent/`, start `pnpm dev`, and ask
for one of the docs-maintenance scenarios. The agent should ask for the working
documentation repository GitHub URL before normal work. After
`configure_working_repository` succeeds, the next session should reuse the
persisted repository setup instead of asking for the same URL again. The
configure step should validate and persist setup quickly; sandbox materializing
can happen later when the docs workflow needs the checkout.

## Eve Evals

`apps/agent/evals/saleor-docs-user-tests.eval.ts` registers both scenarios with hard
assertions for the live agent behavior and repository workflow.

`apps/agent/evals/watched-repositories.eval.ts` registers the first watched-repository
scan scenario. It configures `peelar/saleor-docs` as the working documentation
repository and `saleor/saleor` as a read-only watched repository, then asserts
the agent loads the `watched-repository-scan` skill, uses
`scan_watched_repositories`, and does not call patch or writeback tools for
watched evidence. The scan may use either GitHub App access when the watched
repository is granted to the connector, or public GitHub access when the watched
repository is public and not granted.

`apps/agent/evals/docs-signal-workflows.eval.ts` registers Slack and Linear docs-signal
workflow evals. The Slack case captures a source-backed Slack thread, asserts
that current-docs verification is required, and verifies that missing setup
blocks repository verification before any patch or PR tool is called. The Linear
case captures an issue that lacks source evidence and asserts that current-docs
verification, patch handoff, and writeback are not called.

```sh
pnpm eval saleor-docs-user-tests --skip-report --verbose
pnpm eval watched-repositories --skip-report --verbose
pnpm eval docs-signal-workflows --skip-report --verbose
```

That command validates:

- configure the working repository before running docs maintenance;
- clone, refresh, or reuse the GitHub working repository;
- the model chooses the authored repository workflow tool;
- the model loads the watched-repository scan skill for watched source scans;
- enforce repository allowed actions;
- inspect and patch files inside the sandbox;
- run bounded checks inside the sandbox;
- export diffs;
- keep raw Eve sandbox/file tools disabled for the workflow.
- keep watched repository scans read-only and report-only.
- support watched repository release scans with either GitHub App access or
  explicit public GitHub access.
- capture Slack and Linear docs signals through provider-specific intake tools.
- fail closed for source-backed Slack signals when setup is missing instead of
  verifying, preparing a patch, or opening a PR.
- block Linear issue-tracker signals that lack source evidence before sandbox
  verification or writeback.

The live eval runs git diff checks, but it intentionally does not install
dependencies or run the full Docusaurus production build because those checks
can dominate local microsandbox runtime and belong in narrower CI gates.

By default, evals use the Vercel AI Gateway model configured in
`EVE_GATEWAY_MODEL`, or `zai/glm-5.2` when unset. To test another Gateway model,
set `EVE_GATEWAY_MODEL` to any model id available in the Vercel AI Gateway
catalog:

```sh
EVE_GATEWAY_MODEL=anthropic/claude-sonnet-5 \
pnpm eval saleor-docs-user-tests --skip-report --verbose
```

List the scenarios with:

```sh
pnpm eval --list
```

## Operator Readiness

The Status page is a read-only report over six server-side checks: database and
migrations, working repository setup, GitHub writeback, Slack, Linear, and Eve
runtime health. It uses `configured`, `reachable`, `verified`, `blocked`, and
`unknown` literally; a configured or reachable provider is not shown as
verified when inbound delivery has not been proven.

Run the local database and Eve health smoke with:

```sh
pnpm status:smoke
```

The smoke starts `pnpm dev --no-ui`, waits for `GET /eve/v1/health`, opens the
real Status page, and asserts that the database is `verified` and Eve is
`reachable`. It does not use readiness fixtures.

Use these scenarios when real provider credentials are available:

- GitHub: configure the working documentation repository and GitHub connector,
  grant the app that repository, and open `/status`. GitHub writeback should be
  `verified` only after the repository-targeted installation token, repository
  access, and `contents:write` plus `pull_requests:write` checks pass.
- Slack: open `/status` with the Slack Connect client attached. A successful
  `auth.test` makes the connector `reachable`. Mention Paige in Slack and
  confirm delivery to `/eve/v1/slack`; until the product records that inbound
  operation, the page must keep the manual verification action visible rather
  than claiming `verified`.
- Linear: open `/status` with the Linear Connect client attached. A successful
  viewer query makes the connector `reachable`. Delegate a test issue to Paige
  and confirm delivery to `/eve/v1/linear`; until that inbound operation is
  durably recorded, the page must not claim `verified`.

When a connector, installation, repository grant, permission, or provider is
unavailable, stop at the visible `blocked` or `unknown` result. Do not add local
tokens, bypass Connect, or use test fixtures to make a real-provider scenario
look successful. The page may name server-side variable keys and supported
routes, but it must never render credential values, tokens, or raw connector
responses.

## Deterministic Runtime Checks

`pnpm check` also runs deterministic storage and readiness checks:

```sh
pnpm test
```

The setup-state check covers database-backed setup persistence, stale JSON setup
being ignored, invalid database setup state, and missing deployed database
configuration. The docs-signal queue check covers signal capture, provider/permalink dedupe,
open-signal listing, lifecycle updates, provenance preservation, artifact
storage, missing deployed database configuration, and stale signal status
handling. The docs-impact decision check covers skipped verification, required
current-docs verification, source-evidence blocking, already-covered decisions,
and compatibility mapping from legacy repository-scenario decisions. The Slack
docs-signal check covers explicit Slack thread capture as
`communication-thread` context, Slack thread dedupe, source text preservation
separate from model summaries, setup-gated required verification, completed
current-docs verification state, skipped verification with an explicit reason,
and the no patch/writeback boundary. Typecheck and Eve build cover the
`verify_docs_signal_current_docs` tool surface; live verification behavior should
show materialization of the configured working documentation repository, reads
or searches against likely docs targets, a `docs-verified` lifecycle event, and
no patch or draft PR. The Linear docs-signal check covers Agent Session issue
capture as `issue-tracker-item` context, Linear issue dedupe, labels/project
and status provenance, prompt/comment source text preservation, setup-gated
required verification, completed verification state, skipped verification with
an explicit reason, and the no Linear mutation or writeback boundary. The docs
signal patch handoff check covers `patch-failed` status support, refusal before
current-docs verification, refusal when source evidence is missing, patch and
no-patch input contracts, optional `signalId` publish input, and PR body
provenance for originating signals. The docs signal workflow safety check joins
the Slack, Linear, decision, and patch-handoff boundaries: source-backed Slack
signals require current-docs verification and fail closed when setup is missing,
internal-only signals skip verification with a concrete reason, Linear signals
without source evidence cannot enter patch handoff, and only already verified
patch-recommended signals can proceed to patch preparation. The workspace
memory check covers proposal, explicit promotion, exact/tag search, full memory
reads with source text provenance, stale and retired lifecycle behavior,
freshness filtering, strict rejection of model-supplied workspace ids, deployed
database failure behavior, and prompt-injection trust boundaries in dynamic
instructions. The table-driven readiness check covers every readiness state for
all six items plus probe failures and overall aggregation. Browser checks cover
ready, partial, unknown, blocked, database-down, and provider-down reports on
desktop and mobile.

## Docs-signal Queue

Open `/signals` after the app-owned database contains docs signals. The default
view shows open work only. Each row should show the existing status and source
kind, an operator-safe source summary, priority, uncertainty, next action time,
and updated time. Priority sorts high to low; updated time and stable id break
ties deterministically.

Verify the read-only controls:

1. Filter by one current signal status and confirm only that status remains.
2. Filter by one source kind and confirm only that source remains.
3. Enable **Include closed** and confirm closed signals appear without changing
   any record.
4. Choose filters with no matches and use **Reset filters** to return to open
   work.

The queue payload intentionally excludes raw source text, source authors,
provider ids and metadata, workspace ids, dedupe keys, extracted claims, and
artifacts. Those belong to signal detail or server-side persistence. A database
failure must show migration guidance; an invalid persisted row must stop the
list with a distinct contract error instead of disappearing.

`pnpm check` covers shared-service ordering, filtering, open/closed behavior,
payload redaction, and invalid rows, plus ready, empty, filtered-empty,
database-error, and invalid-record browser states on desktop and mobile.
