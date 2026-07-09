# User Testing

The first user tests validate the sandboxed GitHub working-repository loop with
one public docs repository:

```text
https://github.com/peelar/saleor-docs.git
```

The canonical fixtures live in
`evals/scenarios/saleor-docs-user-test-scenarios.ts`. Copy-paste prompt files
for manual `/goal` runs live in `evals/scenarios/manual/`. Each fixture contains
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

- `evals/scenarios/manual/saleor-docs-private-metadata-filtering.goal.md`
- `evals/scenarios/manual/saleor-docs-sandbox-rate-limit-false-alarm.goal.md`

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

`evals/saleor-docs-user-tests.eval.ts` registers both scenarios with hard
assertions for the live agent behavior and repository workflow.

`evals/watched-repositories.eval.ts` registers the first watched-repository
scan scenario. It configures `peelar/saleor-docs` as the working documentation
repository and `saleor/saleor` as a read-only watched repository, then asserts
the agent loads the `watched-repository-scan` skill, uses
`scan_watched_repositories`, and does not call patch or writeback tools for
watched evidence. The scan may use either GitHub App access when the watched
repository is granted to the connector, or public GitHub access when the watched
repository is public and not granted.

`evals/docs-signal-workflows.eval.ts` registers Slack and Linear docs-signal
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

## Deterministic Runtime Checks

`pnpm check` also runs deterministic storage checks:

```sh
pnpm test
```

The setup-state check covers database-backed setup persistence, legacy JSON
import, corrupt setup state, and missing deployed database configuration. The
docs-signal queue check covers signal capture, provider/permalink dedupe,
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
knowledge check covers proposal, explicit promotion, exact/tag search, full
record reads with source text provenance, stale and retired lifecycle behavior,
freshness filtering, strict rejection of model-supplied workspace ids, deployed
database failure behavior, and prompt-injection trust boundaries in dynamic
instructions.
