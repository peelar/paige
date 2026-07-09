# Project Manifest

## Product Stance

This project is an open-source documentation maintainer agent for software teams
that manage docs as code. Its first job is not to broadly generate prose. Its
job is to inspect engineering context, decide whether documentation is affected,
and make the smallest reviewable docs change when the evidence supports it.

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

The MVP proves the sandboxed GitHub repository work loop. Given a configured
GitHub working documentation repository, PR-like change context, and structured
issue or product context, the agent clones or materializes the repository into
the Eve sandbox, emits a documentation impact report, prepares a minimal
Markdown or MDX patch when warranted, runs checks, exports a diff, and can push
an approved branch or draft PR back to the same working repository.

The first milestone does not need Slack, Linear, Notion, Discord, source
repository, or proactive monitoring integration. GitHub authority is in scope
only for the configured working documentation repository and only after the
sandbox-local patch/check workflow and approval boundary are proven.

## Repository Model

The central project concept is the **working documentation repository**. This is
the GitHub-hosted docs-as-code repository a user provides during onboarding. It
is cloned or materialized into the Eve sandbox at `/workspace/working-docs` and
is the primary mutable target: the agent inspects it, applies sandbox-local
patches to it, exports report and diff artifacts, and uses scoped GitHub
authority to create approved branches or draft PRs in it.

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

**Context repositories** are a later expansion. They can become optional,
read-only evidence sources after the single working-repository loop is proven,
but they are not part of the focused open backlog.

The first user-test fixtures target `https://github.com/peelar/saleor-docs.git`
and live in `evals/scenarios/saleor-docs-user-test-scenarios.ts`. They cover one
evidence-backed docs patch and one false alarm where the correct outcome is no
docs change.

## Not MVP

- Chat SDK adapter work or multi-surface chat routing.
- Slack, Discord, Linear, Notion, or support-thread context ingestion.
- Continuous monitoring of repositories, releases, support channels, or
  community discussions.
- Source or context repository integration.
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
- Follow Eve's installed documentation as the source of truth for runtime
  structure and channel behavior.
- Keep style knowledge inspectable in project files, scenario inputs, evals, or
  future skills rather than hiding it only in prompts.
- Prove the real working-documentation-repository loop before adding broad
  evals or provider integrations.
- Build policy and safety evals before expanding Slack, Linear,
  source-repository, context-repository, or proactive integrations so behavior
  can be regression tested as tools and channels become more capable.

## First Workflow

A maintainer gives the agent a scenario containing:

- a working documentation repository GitHub URL, ref, and docs root;
- a PR-like code change or injected context pack;
- linked structured issue or product context;
- optional existing docs conventions or expected style notes.

The agent inspects the scenario in an Eve sandbox, identifies affected docs
surfaces in the working documentation repository, decides whether a docs change
is needed, and emits a documentation impact report. If a change is needed, it
prepares a minimal docs patch, records which checks ran, exports a diff, and
publishes approved changes back to the same GitHub repository.

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

## Truth Surfaces

- GitHub Issues: executable backlog and completion source of truth.
- `docs/ROADMAP.md`: milestones, appetite, dependencies, and fallback order.
- `docs/REPOSITORY_MODEL.md`: working docs repository, context repository,
  external context, sandbox, and provenance contract.
- `docs/USER_TESTING.md`: manual user-test scenarios, expected outcomes, and
  eval readiness notes.
- `evals/scenarios/`: typed user-test fixture data used by manual tests and
  future executable evals.
- `docs/adr/`: durable decision records, created through `$to-adr`.
- `AGENTS.md`: agent rules and source-of-truth pointers only.
- Installed Eve docs under `node_modules/eve/docs/`: source of truth for Eve
  project layout, runtime behavior, channels, tools, sandbox, connections,
  schedules, subagents, and evals.
