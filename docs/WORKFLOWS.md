# Docs Agent Workflows

Docs Agent work starts from a docs signal and ends with a report, a lifecycle
state change, a patch handoff, or a maintainer question. Current-docs
verification is one capability inside these workflows, not the whole product.

## Workflow Model

### Mentioned In Context

A user brings the agent into a Slack thread or Linear Agent Session. The channel
captures the thread or issue as structured source provenance, creates or dedupes
a docs signal, and runs decision/triage. The agent replies with what it captured,
what evidence is missing, whether current docs were verified, and the next
action.

### Periodic Scan

A user or future schedule asks the agent to check configured sources such as
watched repositories, release feeds, or channel/project scopes. The scan creates
or updates docs signals. It does not write docs directly.

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

| Boundary | Owns | Current implementation | Must not do |
| --- | --- | --- | --- |
| Signal intake | Convert provider context into a docs signal with provenance. | `capture_slack_docs_signal`; `create_docs_signal`, `list_docs_signals`, `get_docs_signal`, `update_docs_signal_lifecycle`; watched scans also create source evidence. | Inspect or patch docs directly. |
| Decision and triage | Classify docs impact, missing evidence, verification need, and next action. | `planDocsImpactDecision` and the shared decision schemas. | Treat Slack or Linear context alone as proof for public docs claims. |
| Current-docs verification | Inspect the configured working documentation repository in the sandbox. | `verify_docs_signal_current_docs` for captured signals; existing scenario workflow in `run_docs_maintenance_scenario`. | Publish or write outside `/workspace/working-docs`. |
| Patch preparation | Prepare minimal working-docs patches, checks, and diff artifacts. | Existing repository workflow for scenarios; later signal-to-patch handoff should reuse it. | Open a PR or write to watched/source repositories. |
| Writeback | Publish an approved draft PR to the working docs repository. | `publish_working_repository_pr`. | Run without explicit approval or target any repository except the configured working docs repo. |

## Tool Mapping

- `capture_slack_docs_signal`: convert an explicit Slack mention or DM thread
  into `communication-thread` external context, create or dedupe a Slack docs
  signal, run shared decision/triage, and return in-thread reply guidance.
- `verify_docs_signal_current_docs`: materialize the configured working
  documentation repository for one signal, read likely docs pages, search likely
  docs terms, record a `docs-verified` lifecycle event, and return evidence
  without patching or publishing.
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

1. A user mentions Docs Agent in a Slack thread: "Does this API change need docs?"
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
8. If docs are stale, patch handoff prepares a diff in the working docs repo.
9. Draft PR publishing waits for explicit approval.

### Linear Issue Without Source Evidence

1. A Linear Agent Session asks Docs Agent to check an issue.
2. The Linear issue is captured as a `linear-issue` signal source.
3. The issue describes intended behavior but links no source, release, or
   maintainer-confirmed implementation evidence.
4. Decision/triage returns `needs-source-evidence`.
5. No sandbox verification runs yet.
6. The agent replies with the missing evidence and next action.
