# Project Manifest

## Product Stance

Docs Agent is an open-source agent for software teams that keep product
documentation in Git. Its first job is not to broadly generate prose. Its job is
to inspect engineering context, decide whether documentation is affected, and
make the smallest reviewable docs change when the evidence supports it.

The agent should be present where work happens. Product decisions, release
intent, support signals, and behavior clarifications often appear in Slack and
Linear before they become a pull request or release artifact. Docs Agent
captures those signals with provenance, decides what kind of docs work they
imply, and verifies the current documentation state when the signal is
substantive enough to justify repository inspection.

The agent is built around Eve as the durable runtime. Eve's filesystem-first
project model is the organizing contract for instructions, tools, skills,
subagents, channels, connections, schedules, sandbox behavior, and evals.

## User And Problem

The primary user is a maintainer, developer advocate, technical writer, or
engineer responsible for keeping product documentation aligned with code and
product changes. Today, a pull request can change behavior without making it
clear whether docs are stale, which page should change, or whether a docs patch
is safe to merge.

Reviewers need an agent that behaves like a careful documentation coworker: it
should assemble the relevant context, explain the docs impact, and avoid writing
when the right answer is no change, changelog only, or ask a maintainer.

## MVP

The current foundation proves the sandboxed GitHub repository work loop. Given a
configured GitHub working documentation repository, PR-like change context,
structured issue or product context, and optional read-only watched repositories,
the agent clones or materializes repositories into the Eve sandbox, emits a
documentation impact report, prepares a minimal Markdown or MDX patch when
warranted, runs checks, exports a diff, and can push an approved branch or draft
PR back to the same working repository.

The next product expansion brings Slack and Linear into scope as explicit
docs-signal intake surfaces. This does not make the agent a broad chat bot or a
ticketing assistant. Slack threads and Linear issues become structured external
context for Docs Agent work; the configured working documentation repository
remains the only mutable target, and writeback remains approval gated.

## Repository Model

The central project concept is the **working documentation repository**. This is
the GitHub-hosted documentation repository a user provides during onboarding. It
is cloned or materialized into the Eve sandbox at `/workspace/working-docs` and
is the primary mutable target: the agent inspects it, applies sandbox-local
patches to it, exports report and diff artifacts, and uses scoped GitHub
authority to create approved branches or draft PRs in it.

Workspace setup is explicit and reusable. The agent checks versioned setup state
on every turn, asks for missing working-repository details before docs work, and
checks GitHub writeback setup before any approved draft PR publish attempt.

Host local paths are not supported as working documentation repository sources
for the main workflow. Local development and production use the same
sandbox-first contract.

The first realistic working documentation repository can be a fork of Saleor
docs. This gives the agent a real docs tree and real checks without requiring
access to Saleor Slack, Linear, or source repositories.

**External context** is structured non-repository evidence, such as a
communication thread, issue-tracker item, decision record, release note, or
customer report. It preserves provenance, source shape, timestamps, authors,
links, and relationships instead of becoming a plain text blob.

**Docs signals** are durable units of Docs Agent work produced from external
context, watched-repository evidence, or future scheduled scans. A signal
records the claim or change being discussed, source provenance, suspected docs
surfaces, uncertainty, related repository or release references, and current
workflow status. Signals let the agent join context that arrives over time
instead of treating each Slack mention, Linear issue, release, or repository scan
as an isolated prompt.

**Watched repositories** are optional, read-only GitHub repositories configured
alongside the working documentation repository. They are source evidence, not
docs targets. The first supported scan uses GitHub release signals for
discovery, verifies candidate terms in a sandboxed read-only checkout, compares
them against the working documentation repository, and reports a docs-impact
judgment without writing.

**Context repositories** as a broader abstraction remain a later expansion.
Watched repositories are the narrow source-evidence path for the current
backlog.

The first user-test fixtures target `https://github.com/peelar/saleor-docs.git`
and live in `evals/scenarios/saleor-docs-user-test-scenarios.ts`. They cover one
evidence-backed docs patch and one false alarm where the correct outcome is no
docs change.

## Not MVP

- Chat SDK adapter work or multi-surface chat routing.
- Ambient ingestion of all Slack, Linear, Discord, Notion, support, or community
  traffic. The next Slack and Linear scope is explicit mention, delegation, or
  configured scan only.
- Continuous monitoring of arbitrary repositories, releases, support channels,
  or community discussions.
- Broad source or context repository integration beyond configured read-only
  watched repository release scans.
- Broad docs platform support beyond Docusaurus-style Markdown and MDX.
- Large rewrites, new documentation sections, or autonomous publishing.
- `llms.txt`, structured documentation bundles, MCP docs endpoints, or other
  AI-reader publishing outputs.

## Principles

- Prefer no docs change over a weak or generic docs patch.
- Treat the documentation impact report as the core output; patches are a
  consequence of the report, not the other way around.
- Keep patches small enough for a human reviewer to understand quickly.
- Cite the evidence used: code diff, structured issue context, existing page
  pattern, considered pages, and remaining uncertainty.
- Distinguish the working documentation repository from read-only context
  repositories in every provenance trail and permission decision.
- Distinguish GitHub release signals, watched-repository source evidence, and
  working-documentation-repository docs evidence in scan reports.
- Treat Slack and Linear context as provenance-bearing docs signals, not as
  loose prompt text.
- Verify the current docs state for substantive docs signals unless the agent
  can clearly explain why repository inspection is unnecessary or premature.
- Follow Eve's installed documentation as the source of truth for runtime
  structure and channel behavior.
- Keep style knowledge inspectable in project files, scenario inputs, evals, or
  future skills rather than hiding it only in prompts.
- Prove the real working-documentation-repository loop before adding broad
  evals or provider integrations.
- Build policy and safety evals before expanding Slack, Linear,
  source-repository, context-repository, or proactive integrations so behavior
  can be regression tested as tools and channels become more capable.

## Repository Workflow

A maintainer gives the agent a scenario containing:

- a working documentation repository GitHub URL, with optional ref and docs root;
- a PR-like code change or injected context pack;
- linked structured issue or product context;
- optional existing docs conventions or expected style notes.

The agent inspects the scenario in an Eve sandbox, identifies affected docs
surfaces in the working documentation repository, decides whether a docs change
is needed, and emits a documentation impact report. If a change is needed, it
prepares a minimal docs patch, records which checks ran, exports a diff, and
publishes approved changes back to the same GitHub repository.

## Signal Workflow

A maintainer, engineer, product manager, or support teammate brings the agent
into the place where work is being discussed:

- by mentioning it in a Slack thread;
- by delegating or mentioning it in a Linear issue or Agent Session;
- by asking it to scan configured release or source signals.

The agent captures structured external context, records provenance, identifies
the likely docs task, and decides whether current docs verification is needed.
For substantive product, API, release, or behavior signals, the normal path is
to materialize the configured working documentation repository, inspect relevant
docs, and return a documentation impact report. The agent may skip sandboxed
repository inspection only when it gives a concrete reason, such as internal-only
discussion, duplicate noise, insufficient information to identify a docs concern,
or an explicit need to wait for source or release evidence.

If a docs patch is warranted, patch preparation and draft PR publishing continue
through the same sandboxed working-repository workflow and approval-gated
writeback boundary.

## Success Signals

- The agent correctly says "no docs change required" for changes that do not
  affect public behavior.
- The agent chooses an existing page instead of creating unnecessary new pages.
- The agent makes minimal diffs that match local docs conventions.
- The report names pages considered but not edited.
- The report distinguishes evidence-backed claims from uncertainty.
- Scenario evals cover docs-needed, no-docs-needed, changelog-only, and
  maintainer-question scenarios.
- A Docusaurus-style build or relevant docs check can be run and reported when
  the scenario provides one.
- Disallowed repository actions, unsupported sources, sandbox setup failures,
  and unapproved push attempts fail visibly.
- Approved changes can be pushed to a draft PR in the configured working
  repository without granting write access to any other repository.
- Missing or stale workspace setup is caught before docs work or writeback
  instead of failing late inside repository tools.
- Configured watched repositories can be scanned for release signals, verified
  in read-only sandbox checkouts, and compared with the working docs repository
  without granting them patch or writeback authority.
- Slack threads and Linear issues can become structured docs signals with stable
  provenance and workflow status.
- Substantive Slack or Linear docs signals trigger current-docs verification
  against the configured working documentation repository, while trivial or
  premature signals are skipped with an explicit reason.
- Signals from Slack, Linear, watched repositories, and release context can be
  joined so the agent does not lose context between discovery, verification,
  patch preparation, and final writeback.

## Open Questions

- Should the typed user-test scenario format in `evals/scenarios/` become the
  durable eval format, or should runtime scenarios use a separate API-facing
  envelope?
- Should the first patch output be a git diff file, a working-tree edit inside
  the sandbox, or both?
- Which scoped GitHub write path should ship first: GitHub App installation,
  Eve GitHub channel checkout/writeback, or an authored GitHub tool?
- How much style knowledge belongs in root instructions versus a load-on-demand
  Eve skill?
- Which docs check should be mandatory for the first working docs repository
  scenario: build, typecheck, link check, or a lighter smoke check?
- What is the smallest Drizzle/libSQL schema that can support docs signals,
  workflow status, and cross-channel provenance without overbuilding the first
  queue implementation?
- What is the smallest stable runtime envelope for a docs signal consumed by
  Slack intake, Linear intake, watched-repository scans, scheduled scans, and
  eval scenarios?

## Truth Surfaces

- GitHub Issues: executable backlog and completion source of truth.
- `docs/ROADMAP.md`: milestones, appetite, dependencies, and fallback order.
- `docs/REPOSITORY_MODEL.md`: working docs repository, watched repository,
  context repository, external context, sandbox, and provenance contract.
- `docs/USER_TESTING.md`: manual user-test scenarios, expected outcomes, and
  eval readiness notes.
- `evals/scenarios/`: typed user-test fixture data used by manual tests and
  future executable evals.
- `docs/adr/`: durable decision records, created through `$to-adr`.
- `AGENTS.md`: agent rules and source-of-truth pointers only.
- Installed Eve docs under `node_modules/eve/docs/`: source of truth for Eve
  project layout, runtime behavior, channels, tools, sandbox, connections,
  schedules, subagents, and evals.
