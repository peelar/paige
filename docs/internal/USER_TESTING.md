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

### Real Source-backed Gap: EditorJS Table Support

Saleor 3.23.9 shipped support for `@editorjs/table`, but the current
3.22-to-3.23 upgrade guide still presents an exhaustive supported-extension
list without it. The executable scenario preserves the original Slack thread,
release, and source PR as attached provenance while exercising Paige's general
repository and authoring path.

Expected result:

- Clone, refresh, or reuse `peelar/saleor-docs` in
  `/workspace/working-docs`.
- Inspect `docs/upgrade-guides/core/3-22-to-3-23.mdx` and nearby conventions.
- Choose a focused patch without creating a content plan or new page.
- Add `@editorjs/table` to the supported EditorJS extension list with its
  correct package link and 3.23.9 version context.
- Leave generated API reference files untouched.
- Run sandboxed git diff checks before exporting a diff.
- Leave publication waiting for explicit approval.

### Incorrect: Pagination Benchmark False Alarm

The user prompt suggests that connection queries now allow 250 objects per
page. The attached source context says 250 was only a local benchmark value,
while the public API limit remains 100 and the current pagination guide already
states that limit.

Expected result:

- Inspect `docs/api-usage/pagination.mdx`.
- Report that the supported maximum remains 100 objects per query.
- Produce no patch and export an empty diff.
- Do not invoke authoring or writeback capabilities.

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

## Manual Slack Loop

The real EditorJS gap also remains available as a two-message Slack thread for
provider-intake testing. Copy the messages from
`apps/agent/evals/scenarios/manual/saleor-docs-editorjs-table-support.slack.md`.
The first mention should capture and verify the signal without patching. After
Paige reports the stale guide, the second message requests a reversible patch
and checks in the same thread. A third, optional message explicitly approves a
draft PR.

Keep the human review contract out of Paige's context while testing:
`apps/agent/evals/scenarios/manual/saleor-docs-editorjs-table-support.review.md`.

## Eve Evals

`apps/agent/evals/saleor-docs-user-tests.eval.ts` registers four executable
scenarios: the two historical cases, the source-backed EditorJS gap, and a
repository-generic pagination no-change case whose language cannot match the
historical fixture routes. Assertions cover semantic outcomes, evidence,
changed-file authority, checks, empty or focused diffs, and publication
boundaries without prescribing one exact tool sequence. The manual EditorJS
Slack thread remains complementary provider-intake coverage.

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
- the model composes the reusable repository and authoring capabilities;
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

## Chat SDK State

The repository gate includes deterministic local conformance and concurrency
coverage for the libSQL Chat SDK state adapter. To exercise the same adapter
against an already migrated hosted Turso database, run:

```sh
DOCS_AGENT_DATABASE_URL=libsql://... \
DOCS_AGENT_DATABASE_AUTH_TOKEN=... \
pnpm --filter @docs-agent/control-plane test:chat-state:remote
```

The smoke uses unique temporary keys and thread ids, verifies subscriptions,
locks, TTL-backed values, and NX behavior, and cleans up its state. Missing
remote configuration fails visibly instead of using the local database.

## Operator Readiness

The Status page reports six server-side checks: database and
migrations, working repository setup, GitHub writeback, Slack, Linear, and Eve
runtime health. It uses `configured`, `reachable`, `verified`, `blocked`, and
`unknown` literally; a configured or reachable provider is not shown as
verified when inbound delivery has not been proven.

Run the local database and Eve health smoke with:

```sh
pnpm status:smoke
```

The smoke starts `pnpm dev:agent --no-ui`, waits for `GET /eve/v1/health`, opens the
real Status page, and asserts that the database is `verified` and Eve is
`reachable`. It does not use readiness fixtures.

Use these scenarios when real provider credentials are available:

- GitHub: configure the working documentation repository and GitHub connector,
  grant the app that repository, and open `/status`. GitHub writeback should be
  `verified` only after the repository-targeted installation token, repository
  access, and `contents:write` plus `pull_requests:write` checks pass.
- Slack: open `/status` with the Slack Connect client attached. A successful
  `auth.test` makes the connector `reachable`. Mention Paige in Slack and
  confirm delivery to `/eve/v1/slack`. The verified webhook records
  connector-bound delivery proof. Select **Recheck installation** and confirm
  the trigger becomes `verified` without restarting workspace onboarding.
- Linear: open `/status` with the Linear Connect client attached. A successful
  viewer query makes the connector `reachable`. Delegate a test issue to Paige
  and confirm delivery to `/eve/v1/linear`. The verified Agent Session webhook
  records connector-bound delivery proof. Recheck and confirm the trigger and
  relevant grant become `verified`.

When a connector, installation, repository grant, permission, or provider is
unavailable, stop at the visible `blocked` or `unknown` result. Do not add local
tokens, bypass Connect, or use test fixtures to make a real-provider scenario
look successful. The page may name server-side variable keys and supported
routes, but it must never render credential values, tokens, or raw connector
responses.

## Connector Installation Handoffs

Use the authenticated `/status` page for installation. Each provider shows
connector, installation, trigger, and relevant grant separately. The page
renders placeholders such as `<uid>` instead of the configured connector id and
never renders credentials.

For Slack, use an interactive terminal or the linked Vercel Connect dashboard:

```sh
vercel connect create slack --triggers --icon ./assets/paige/paige-magpie-master.png
vercel connect update <uid> --icon ./assets/paige/paige-magpie-master.png --format=json
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/slack --yes
```

Confirm the branding result contains a non-empty `icon`, complete Slack
workspace consent in the browser, then send a real app mention or direct
message and recheck. Token issuance alone verifies installation, not event
subscription or trigger delivery.

For Linear, use the same supported flow at the Agent Session route:

```sh
vercel connect create linear --triggers
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/linear --yes
```

The provider app must have `app:assignable` and `app:mentionable`, and its
webhook categories must include `AgentSessionEvent`. Delegate or mention Paige
in a real issue, then recheck. A viewer query without Agent Session delivery is
still incomplete.

GitHub writeback is outbound in this runtime, so its trigger is explicitly
`not-applicable`. Create or open the GitHub connector, let a GitHub administrator
install the app, grant the configured working repository, and grant
`contents:write` plus `pull_requests:write`. The server verifies an
installation-scoped token against that exact repository before marking the
grant verified.

These flows require provider consent or administrator approval. In headless
automation, stop at the human-action message and hand the browser step to an
authorized administrator. Do not substitute a runtime OAuth prompt, local
token, or synthetic webhook receipt.

## Operator GitHub OAuth Smoke

Run this scenario against a preview or production-like `apps/web` deployment
before closing [#37](https://github.com/peelar/docs-agent/issues/37). Test-only
auth does not satisfy this smoke.

1. Configure the deployment with `DOCS_AGENT_OPERATOR_ACCESS=github`, a fresh
   `BETTER_AUTH_SECRET`, its public `BETTER_AUTH_URL`, GitHub OAuth credentials,
   and a server-only `DOCS_AGENT_APPROVED_GITHUB_LOGINS` containing the tester.
   Register `<BETTER_AUTH_URL>/api/auth/callback/github` in the GitHub OAuth app.
2. Open a protected route in a clean browser profile. Confirm it redirects to
   `/sign-in`, then to GitHub with an opaque state value. Complete GitHub consent
   and confirm the callback returns to the control plane.
3. Confirm `/status` and `/signals` navigate without another login, a reload
   restores the session, and `/api/operator/whoami` returns the stable
   `docs-agent:github:<account-id>` principal and normalized login. Inspect the
   browser storage view: auth cookies are secure, HTTP-only, same-site, and no
   provider token is readable from page code.
4. Remove the tester from `DOCS_AGENT_APPROVED_GITHUB_LOGINS` and redeploy or
   restart. Without clearing cookies, confirm a protected page and
   `/api/operator/whoami` both return forbidden. Restore the allowlist.
5. Sign out and confirm the protected API returns unauthorized and a protected
   page returns to `/sign-in`. Complete one more login, wait for or deliberately
   issue an expired test deployment session, and confirm the same recovery.
6. Record the deployment URL, GitHub login used, UTC time, and pass/fail evidence
   in the issue. Do not record the Better Auth secret, OAuth client secret,
   cookies, authorization code, access token, or raw callback URL.

Keep the Eve deployment on its own origin during this scenario. The web cookie
must not authorize Eve routes; a future operator-to-Eve action needs the
server-to-server `AuthFn` bridge described in `docs/internal/ADMIN_UI.md`.

## Guided Workspace Onboarding

Use an authenticated operator session and a non-production GitHub App
installation. Start from `/status` with a clean or deliberately incomplete
workspace setup.

1. Enter the working documentation repository and the existing GitHub connector.
   Leave the ref empty and confirm validation uses `main`. Leave docs root empty
   and confirm it remains unset for later checkout-time inference.
2. Validate with a missing ref, an ungranted repository, and insufficient
   `contents:write` or `pull_requests:write` permission in turn. Each result must
   stay visible in the preflight ledger, the save action must stay absent, and
   neither `workspace_setup` nor `workspace_setup_events` may change.
3. Restore repository access and permissions, then validate again. Confirm the
   repository, GitHub writeback, and watched-repository checks all pass before
   the save action appears.
4. Add one watched repository and save. Confirm it persists with
   `sandbox-read`, only `clone`, `read`, `search`, `inspect-diff`, and
   `run-readonly-checks`, plus its `watched-repository:<owner>/<repo>` provenance
   label. It must not gain `patch`, `export-diff`, or `publish-pr`.
5. Confirm the Status page refreshes from the canonical readiness service. In an
   agent conversation, inspect setup status and confirm it reads the same
   working repository, `main` ref, and watched repository without asking for
   setup again.
6. Inspect the latest `workspace_setup_events` entry. It should contain the
   saved setup snapshot, `workspace-onboarding-saved`, the stable operator id,
   and normalized GitHub login. It must not contain a connector token or GitHub
   credential.

Provider app creation, Vercel Connect installation, and GitHub consent remain
outside this flow. A missing installation is a visible human action, not a
successful onboarding result.

### Slack Chat SDK End-to-End

Use a non-production Slack channel and the installed `slack/paige`
connector. The Slack app must deliver `app_mention`, `message.im`,
`message.channels`, and `message.groups` events to the unchanged
`/eve/v1/slack` trigger, and must have the matching history scopes plus
`chat:write` and `users:read`.

1. Post an ordinary top-level channel message without mentioning Paige. Confirm
   there is no reply, Eve run, or new `chat_sdk_*` content for that thread.
2. Mention Paige in a thread that already has human replies. Confirm she sees
   only context after her previous reply, replies in the same thread, and the
   connector token and Vercel OIDC verification path are used. Confirm one
   active `slack_thread_presence` row and one Chat SDK subscription exist for
   the thread.
3. Reply normally without mentioning Paige. Ask a direct follow-up, then ask an
   answerable documentation question to the room. Confirm both continue the
   same Eve thread and receive useful replies.
4. Send two short replies within one second. Confirm they produce one debounced
   observer turn containing both messages rather than overlapping runs.
5. Add unrelated lunch or scheduling chatter. Confirm there is no Slack reply
   and no new or updated docs signal. Then add plausible product, API, release,
   support, or documentation context and confirm Paige may call
   `capture_slack_docs_signal` without treating the conversation itself as
   implementation evidence.
6. Say `Paige, stop following this thread.` Confirm the acknowledgement,
   dismissed presence, and removed subscription. Post another ordinary reply
   and confirm there is no reply, Eve run, or persisted Chat SDK message.
7. Re-enroll a non-production thread if needed and verify that presence older
   than seven days of inactivity is rejected and marked expired on the next
   ordinary message.
8. Send Paige a DM and confirm the response remains in that DM conversation.
9. Exercise a tool that requests human input. Confirm the Slack card resumes the
   same Eve session as the user who clicked it.
10. Send a bot message, edit, delete, and unsupported subtype. Confirm none starts
   an Eve run. A followed message must also remain ordinary conversation unless
   Paige explicitly calls `capture_slack_docs_signal` for relevant evidence.

The executable participation eval covers direct continuation, an unaddressed
answerable docs question, unrelated chatter that stays silent, and relevant
context that calls the existing Slack intake tool. It was run for #30 with:

```sh
pnpm eval slack-participation --skip-report --verbose
```

Result on 2026-07-11: four cases passed and all twelve eval gates passed.

### Slack Real-time Search End-to-End

Use a Slack app that is internal or directory-published, follows Slack's
[Real-time Search API requirements](https://docs.slack.dev/apis/web-api/real-time-search-api/), has
`search:read.public`, and is subscribed to `app_mention` plus the supported
message events. Add `search:read.private`, `search:read.mpim`, or
`search:read.im` only for surfaces the workspace deliberately supports, and
grant the corresponding per-user consent before testing them.

1. In a public test channel, create a separate public thread containing a
   distinctive documentation-related decision and a source link. Keep its raw
   wording out of the thread where Paige will be invoked.
2. In another public channel, mention Paige and ask a question that explicitly
   references the missing discussion. Confirm `retrieve_slack_context` calls
   `assistant.search.context` once with at most five results, answers with a
   paraphrased summary, and cites the relevant Slack permalink.
3. Confirm the answer says the Slack discussion is context rather than verified
   evidence for a public documentation claim. Confirm no docs signal or
   workspace memory is created merely because search returned a result.
4. Search for a unique phrase that has no accessible result and confirm Paige
   reports that no accessible messages were found instead of guessing.
5. From a public channel, request private-channel or DM context and confirm the
   request is rejected. Then test from an approved private surface with and
   without user consent, confirming success only with the installed scopes and
   consent and a visible permission failure otherwise.
6. Reuse the turn after one search, remove a required scope, use an expired
   interaction, and exercise Slack rate limiting. Confirm there is no automatic
   pagination or retry and each condition is reported without showing a token.
7. Inspect the app database, Eve run history, Chat SDK state, docs signals,
   workspace memories, and application logs for a unique raw result phrase and
   the event `action_token`. Confirm neither value is present; only the derived
   summary and Slack permalink may appear in the Eve answer history.

The deterministic coverage for successful retrieval, no results, requester and
public/private permission boundaries, missing or expired authorization, missing
scope or consent, one-call rate limiting, exact-copy suppression, Chat SDK event
redaction, and database persistence redaction runs through `pnpm check`.

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

## Signal Detail

Open a signal summary from `/signals` and confirm the stable `/signals/<id>`
route presents one read-only product record. Review the source summary, current
status, priority, uncertainty, next action, extracted claims, likely docs pages
and concepts, product surfaces, missing evidence, provenance, lifecycle, links,
and artifacts.

The provenance section labels stored source text as **Verbatim source content**
so it cannot be mistaken for the model-generated summary or claims. Provider,
authors, source/capture timestamps, and safe HTTPS permalinks should be visible.
Markup in source text must remain literal text and must not execute.

Lifecycle events run chronologically from capture to the latest transition and
show actor, reason, statuses, and time. Verification reports, check logs, diffs,
and draft PRs render as distinct artifact kinds, with safe external links when
available. Credential-shaped metadata values render as `[redacted]`; internal
workspace, provider, and dedupe ids do not enter the operator projection.

Verify missing, corrupt, unauthorized, and database-failure detail states. Each
must stop visibly and return to the queue without mutating lifecycle state,
priority, links, or artifacts. `pnpm check` covers the projection and all detail
states on desktop and mobile.

## Workspace Memory Review

Open `/memories` in an authenticated operator session with proposed, active,
stale, and retired records in the app-owned database.

1. Filter each lifecycle status and memory kind, then search statement, scope,
   summary, and tags. Confirm expired active memory is labelled
   **Active · expired**, explicit stale memory is labelled **Stale**, and a
   fresh active memory stays distinct from both.
2. Open a detail record. Confirm kind, statement, scope, summary, tags,
   confidence, freshness, sources, and chronological lifecycle events are
   present. Model-generated memory text and verbatim provenance must be in
   separate sections. Markup in source text must remain inert.
3. Inspect the browser payload. It must not contain workspace ids, provider
   external ids, raw source metadata, credential-shaped URLs, tokens, or
   secrets. Safe HTTPS source links may remain.
4. Promote a proposed memory with a reason. Confirm the stored record becomes
   active and a `memory-promoted` event carries that reason and the stable
   authenticated operator id.
5. Mark an active memory stale with a reason, then retire a stale memory with a
   reason. Confirm each action appends its lifecycle event instead of editing
   prior events or memory text. Retired memory offers no further transition.
6. Submit a lifecycle request with a browser-supplied `actor`. Confirm the API
   rejects it. Clear the operator session and confirm both the page and mutation
   route are unavailable.

Every list and detail view repeats the trust boundary: workspace memory is
routing and triage context, not proof for public documentation claims. Public
claims still require source evidence and current-docs verification.

`pnpm check` covers shared lifecycle projections and transitions, fresh versus
expired states, unsafe-link removal, browser actor rejection, list/detail error
states, inert provenance, filtering, and desktop/mobile layouts.

## Product Run History

Open `/runs` in an authenticated operator session with active,
waiting-for-input, failed, completed, and expired records.

1. Filter by status and run type, then search a signal id, session id, run id,
   model, or signal summary. Confirm each state remains visually distinct.
2. Open a run. Confirm its related signal or workflow id, Eve session and run
   ids, trigger, model, timing, token summary, and product-level steps are
   present. Waiting and failure summaries must be bounded product text, not raw
   prompts or provider responses.
3. Inspect Eve, Vercel, and OpenTelemetry links. An inaccessible trace must say
   **Unavailable** while a completed run remains **Completed**.
4. Inspect the browser payload and app-owned database. They must not contain
   model input or output, messages, reasoning, tool payloads, authorization
   challenges, credentials, or the durable event stream.
5. Advance the clock past `expiresAt`, run bounded cleanup, and confirm the run
   plus its step and trace projections are deleted. External traces retain
   their own lifecycle.
6. Clear the operator session and confirm `/runs` redirects to sign-in. Verify
   missing, invalid, unauthorized, and database-failure states stop visibly.

Run `pnpm --filter docs-agent test:run-index:integration` to start a real local
Eve fixture session, record its stable run reference, project its lifecycle,
and prove the product detail links to—but does not copy—the durable stream.
`pnpm check` covers deterministic index behavior. `pnpm check:full` also covers
the representative desktop and mobile browser states.

## Approval Inbox

Open `/approvals` in an authenticated operator session while Eve has parked
`publish_working_repository_pr` requests from at least two channels.

1. Confirm list rows show the related signal, proposed action, target
   repository, requester, age, and pending or expired state without exposing a
   continuation token or provider credential.
2. Open detail and review the current verification report, prepared diff,
   repository checks, target repository, and exact safe publish input.
3. Approve with a reason. Confirm the original Eve session resumes, writeback
   executes once, the request becomes approved, and the audit record names the
   authenticated operator. Retry the same idempotency key and confirm it is a
   replay; use another key and confirm the answered request is rejected.
4. Deny a separate request. Confirm the original session resumes without
   executing writeback. Approve a third parked request through its native
   channel and confirm the inbox does not interfere.
5. Exercise stale, already-answered, expired, Eve-unavailable, and failed-resume
   paths. None may execute the tool or discard a retryable pending request.
6. Clear the web session and confirm both inbox pages and the decision API are
   unavailable. Submit a browser-supplied actor and confirm it is rejected.

Run `pnpm --filter docs-agent test:approval-integration` for the real local Eve
approve, deny, duplicate, and channel-native scenarios. `pnpm check` covers the
deterministic service contract and desktop/mobile browser states.

## Validation Result Recording

Run a normal eval without `--skip-report`, then inspect the app-owned database.
Confirm the run records its suite, local or remote target, runtime model and
revision when available, start/end time, duration, 30-day expiry, and final
outcome. Cases should preserve passed, failed, soft-threshold/flaky, and skipped
states separately. A started run that never completes must remain missing.

Inspect the record as serialized JSON. It must not contain the eval prompt,
model output, private source context, reasoning, event stream, tool payload,
credential, assertion argument, or free-form assertion label. Failure excerpts
must redact recognized tokens. Replay the same stable run and case ids and
confirm no duplicate rows appear. Break database readiness and confirm the eval
command fails rather than reporting successful persistence.

Run `pnpm --filter docs-agent test:validation-reporter-integration` to execute
one real deterministic Eve eval against a temporary database and read its
record back. `pnpm check` covers schema, service, reporter mapping, all five
outcomes, strict omission, redaction, idempotency, retention, bounded cleanup,
and visible persistence failures. The browser does not run evals or arbitrary
validation commands in this slice.

## Assurance And Regression View

Open `/assurance` in an authenticated operator session. Confirm every record
shows suite, target, model when applicable, commit or deployment, start time,
duration, case counts, proof type, and result. Filter live model evals and
deterministic validation separately. Missing, skipped, flaky, failed, passed,
and expired must remain distinct and no non-passing state may use passed copy or
styling.

Open a run and inspect the recorded assurance log. Confirm each case names the
related behavior, assertion kind, gate or soft severity, threshold and score
when available, redacted failure, timing, and safe artifact reference. Inspect
the HTML and server payload for prompt, output, source context, reasoning,
credentials, raw events, and tool payloads; none should be present.

Choose an earlier baseline. Only the same suite, proof kind, and target class
should be available. Confirm failed or missing cases are regressions, repaired
cases are improvements, and removed assertions, gate-to-soft changes, or lower
thresholds are explicitly weakened. An incompatible baseline must stop visibly.
The page must not expose a command input, eval trigger, or assertion editor.

`pnpm check` covers the typed read service, corrupt records, baseline
compatibility and weakening, production build, authentication, list/detail,
filters, loading, empty, failure, and desktop/mobile states. For the real-data
proof, run `test:validation-reporter-integration` with
`DOCS_AGENT_VALIDATION_INTEGRATION_DATABASE_URL` pointing at a temporary local
database, start `pnpm dev:web` with that same database, and confirm the list and
detail outcomes match the recorded Eve summary.

## Repository Docs Profile

Fast repository setup with `configure_working_repository` and `prepareNow:
false` should validate and persist setup without cloning or building a profile.
The first workflow that materializes `/workspace/working-docs` should build the
profile from a bounded set of repository instruction, configuration,
navigation, package-script, and representative docs files.

Call `get_docs_profile` with up to five nearby `taskPaths`. Confirm the response
names likely audiences, navigation, page types, style and terminology patterns,
reusable components, validation commands, confidence, and exact source paths.
Task examples should contain only the requested repository-relative pages and
must not become profile rules or active workspace memories.

Repeat against the same revision and unchanged source files to confirm
`reused: true`. A changed resolved revision, modified profile source,
expiration, explicit `maintainer-correction`, `contradiction`, corrupt cache, or
unsupported format must rebuild. Missing source files or inspection failure
must fail visibly. Maintainer corrections may be proposed separately with
`memory_propose`; profile inference never promotes memory.

`pnpm check` covers cache identity, reuse, revision/source invalidation, expiry,
contradiction refresh, repository rule and validation extraction, local example
loading, traversal rejection, and visible generation failure.

## Scheduled Follow-up Checklist

Create an existing docs signal, then call `docs_follow_up` with a UTC due time
and short reason. Confirm the checklist is stored in the app-owned database and
the signal's next action reflects its earliest pending follow-up. Listing and
cancelling should update that projection without creating a second work queue.

Build the agent and confirm Eve discovers `daily-docs-follow-ups` with cron
`0 9 * * *`. In development, dispatch it once through Eve's schedule route.
`process_due_docs_followups` should claim at most 20 items, append one due event
to each relevant signal, and return them for the normal evidence-first workflow.
Dispatch the same UTC occurrence again and confirm it returns the existing run
without duplicate item events.

Use `docs_follow_up` in `schedule-status` mode to inspect completed counts and
the last failure. A processor failure must be recorded and then fail the task
visibly. Scheduled work must never call `publish_working_repository_pr`; later
publication still requires a user-driven approval-gated session. The Vitest
case `packages/control-plane/tests/docs-follow-ups.test.ts` covers persistence,
earliest due projection, bounded/idempotent processing, signal updates, replay,
explicit UTC, and durable failure information through `pnpm check`.

## Substantial Owned Work

Start with a captured docs signal and ask Paige to “take care of” a substantial
documentation outcome. Confirm `owned_docs_work` records one work id plus the
originating signal, conversation, Eve session, starting/latest run, intended
outcome, and revision. The acceptance update should be concise; Paige should
then continue through reversible verification, editorial recommendation,
content planning, multi-file authoring, and validation without asking for a new
prompt between each step.

Record routine repository reads, edits, retries, and successful checks. They
must appear as signal events or artifacts but return no `channelUpdate`. Content
plan, materially changed approach, blocker, draft readiness, publication
approval, and completion should return meaningful updates. Open the same signal
in `/signals/:id` and confirm the owned-work card, ordered activity, and typed
artifacts are inspectable without exposing the internal operation key or
workspace id.

Exercise a missing-evidence or consequential-decision park, then answer in the
same Eve session and resume the same work id. A stale revision, duplicate start,
replayed operation, or different-session takeover must not create duplicate work
or artifacts. Apply a correction and confirm Paige revises the current
recommendation, plan, and draft references. Also exercise pause/resume and
abandon; abandonment should reset any reversible draft separately.

At draft readiness, Paige should record an approval-request milestone but must
not call `publish_working_repository_pr` until approval is explicit. The
`owned-docs-work.eval.ts` cases cover inline work, uninterrupted substantial
work, park/resume, correction, quiet routine activity, and publication waiting.
`packages/control-plane/tests/owned-docs-work.test.ts` runs the deterministic idempotency, concurrency,
milestone, artifact, session, correction, pause/resume, approval, completion,
and abandonment contract through `pnpm check`.

## Internal Working Documents

Ask Paige to keep a durable internal note for documentation work that must
survive the current Eve session. She should load the
`internal-working-document` skill and use `internal_document`, not workspace
memory, owned docs work, a public repository draft, or hidden conversation
history.

For the live proof, give a `living-summary` document both a superseded
hypothesis and the current source evidence. Paige should keep the current
conclusion and omit the obsolete one. Give a `chronological-log` two dated
decisions and confirm both remain. Both behaviors must use the same tool and
`docs_work.manage` authority. The deterministic service test separately proves
cross-session read, compare-and-swap update, and revision history behavior.

Run the executable behavior proof with:

```sh
pnpm eval internal-working-documents --skip-report --verbose
```

The control-plane test `packages/control-plane/tests/internal-documents.test.ts`
covers server-owned authority and provenance, workspace isolation, typed
attachment authority, atomic relationship deduplication, retries, cross-session
reads, historical revisions, optimistic concurrency, lifecycle, UTF-8 content
bounds, revision bounds, and retention expiry. Database migration parity,
capability inventory, `pnpm check`, and `pnpm check:full` cover the remaining
handoff contract.

## Editorial Intervention Choice

After current-docs verification and `get_docs_profile`, ask Paige to choose an
intervention with `editorial_recommendation`. Confirm the concise result names
the reader problem, repository evidence, chosen intervention, important rejected
alternatives, and remaining uncertainty without becoming a second content plan.

Exercise the behavioral cases in `editorial-interventions.eval.ts`: a requested
new page that duplicates a canonical guide should become a focused patch; a
small canonical-page gap should also become a focused patch; fragmented or
obsolete pages should be consolidated; a distinct administrator task should
produce a new document; an explicitly reaffirmed new-document choice should be
followed after the tradeoff is understood; and missing public-behavior evidence
should choose `wait-for-evidence` and produce no draft. Substantial choices must
call `content_plan`; focused patches must not.

The Vitest case `apps/agent/tests/editorial-recommendation.test.ts` keeps the typed handoff and
safety behavior in `pnpm check`. It covers every supported intervention,
duplicate-page challenge, focused-patch authoring without a plan, consolidation
handoff, reaffirmed maintainer direction, recommendation revisions, and a
missing-evidence pause before sandbox mutation. It deliberately does not encode
documentation quality as a scoring engine.

## Substantial-work Content Planning

After `editorial_recommendation` chooses a new page, coordinated page set,
restructure, migration guide, or broad replacement, call `content_plan` before
authoring. Confirm the complete artifact identifies the reader and outcome,
content type and placement, affected surfaces, outline, evidence, examples,
assets, unresolved decisions, validation, and definition of done. The returned
progress update should be concise and `continuesToDraft` should be true without
an approval prompt when the plan is ready.

Call `authoring_workspace` with the same task or docs-signal reference. Confirm
the draft records the plan id and revision, and that a later `content_plan`
revision remains attached across turns. A single localized change to an
existing page should work without creating or displaying a plan.

Repeat with missing evidence or an unresolved consequential product decision.
The plan should return `continuesToDraft: false`; authoring must stop before any
sandbox mutation. New files and other clearly substantial operations must also
fail visibly when no matching ready plan exists. The Vitest case
`apps/agent/tests/content-planning.test.ts` covers the small-patch skip,
ready-plan continuation and revision, substantial-work enforcement, and
blocker pause through `pnpm check`.

## Multi-file Authoring Workspace

Use `get_docs_profile` first, then call `authoring_workspace` in `apply` mode
with one coherent operation batch. The supported operations write complete text
files, add base64 binary assets, copy, move, and delete repository-relative
files. Exercise at least one file outside `docsRoot`—for example navigation or
configuration—to confirm the authority boundary is the complete working
repository. `../` traversal and absolute paths must fail.

Call `inspect` in a later turn to review the retained changed-file list, full
binary-aware diff, and selected text files. Call `prepare` with the repository
checks indicated by the docs profile. The prepared draft must retain its base
revision, task references, operation count, check results, and complete diff.
A changed local or remote base must stop preparation or publication visibly and
require re-materialization.

Use `abandon` to restore the sandbox working tree without changing the source
repository. Sandbox authoring requires no approval. Only
`publish_working_repository_pr` may create a branch and draft PR, and it remains
always approval-gated. Approved writeback supports text and binary additions or
modifications, deletions, and moves/renames as one tree; an existing matching
branch and PR are returned rather than published twice.

The Vitest case `apps/agent/tests/authoring-workspace.test.ts` creates a complete page,
updates navigation and related content, adds a binary asset, copies, moves, and
deletes files, inspects the draft across calls, runs repository build and diff
checks, proves stale-base and traversal failures, verifies publish-tree entries,
and abandons back to a clean checkout. It runs through `pnpm check`.

## Instruction Context Boundaries

Issue #32 moved universal rules into `instructions/principles.md` and
situational repository and provider-intake procedures into load-on-demand
skills. `identity.md`, dynamic setup, and dynamic workspace-memory instructions
remain unchanged. `apps/agent/tests/instruction-boundaries.test.ts` keeps the monolith absent,
the identity byte-for-byte stable, the standing context below 220 words, and
the three workflow skills present through `pnpm check`.

The required live baseline was run before the refactor. `docs-signal-workflows`
completed its Slack path and missed only the existing Linear final-reply gate.
`saleor-docs-user-tests` and `watched-repositories` both stopped at the existing
required GitHub validation boundary because this environment has no GitHub
connector; neither reached repository execution.

After the refactor, `docs-signal-workflows` passes all three scenarios and all
45 gates, including a focused intent-level `docs-signal-intake` routing case.
The focused `docs-maintenance` routing case passes all five gates. The watched
workflow still loads `watched-repository-scan` before reaching the same missing
GitHub connector boundary. Re-run the two repository-backed suites in an Eve
environment with the GitHub connector configured before closing #32:

```bash
pnpm eval saleor-docs-user-tests --skip-report --verbose
pnpm eval watched-repositories --skip-report --verbose
```

## Behavior Settings

Open `/settings` as an authenticated operator. Confirm the page offers named
choices for response depth, directness, warmth, pushback, uncertainty handling,
Slack entry, and followed-thread continuation. There must be no prompt textarea
or editable evidence, safety, provenance, sandbox, approval, mutation, or
publishing rule.

Change at least one personality choice and one participation choice. Confirm
the preview explains the likely behavior without promising exact wording. Save
the settings, reload the page, and confirm the choices persist with a new audit
entry. A forced database failure must leave Save disabled or return a visible
error; it must not pretend the change succeeded.

For Slack entry, verify a disabled mention or DM path is rejected before Chat
SDK persists or processes the message. For followed-thread continuation, verify
`direct-only` stays silent for an unaddressed room question and `off` removes
active presence without processing the ordinary reply. None of these choices
may widen tool, repository, or publishing authority.

The deterministic persistence, schema, instruction, and Slack adapter checks
run through `pnpm check`. The live behavior suites were also run with:

```sh
pnpm eval behavior-settings --skip-report --verbose
pnpm eval slack-participation --skip-report --verbose
```

Result on 2026-07-12: the three personality cases passed all nine gates, and the
five Slack participation cases passed all fifteen gates. Desktop and mobile
Playwright scenarios passed with no horizontal overflow or browser console
errors.
