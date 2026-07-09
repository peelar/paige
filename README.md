# Docs Maintainer Agent

An Eve-based documentation agent for keeping Git-backed documentation
repositories aligned with software changes.

The agent is meant to behave like a documentation maintainer: inspect the code
change and surrounding context, decide whether docs are affected, explain the
impact, and only then prepare a small reviewable docs patch when the evidence
supports it.

The first runnable version is scenario-first. It will use PR-like changes,
GitHub-hosted Docusaurus-style working documentation repositories cloned or
materialized into the Eve sandbox, structured context fixtures, and approved
GitHub writeback through app-scoped Vercel Connect before wiring Slack, Linear,
Notion, Discord, or other team-context access.

For the durable product contract, read `docs/MANIFEST.md`. For milestone order
and issue dependencies, read `docs/ROADMAP.md`. For the repository and sandbox
contract, read `docs/REPOSITORY_MODEL.md`.

## What This Becomes

The near-term goal is a reliable Eve workflow that produces documentation impact
reports, minimal Markdown or MDX patches, check results, exported diffs, and
approved draft PRs with provenance.

The longer-term direction is a documentation operations agent: connected to the
places where product and engineering decisions happen, able to detect missing or
stale docs, propose reviewable changes, and eventually help publish docs that
are useful to both humans and AI readers.

## Project Map

- `agent/agent.ts`: Eve root agent configuration.
- `agent/instructions.md`: always-on identity and standing behavior for the
  documentation maintainer agent.
- `agent/instructions/`: dynamic Eve instructions, including per-turn setup
  state guidance.
- `agent/channels/`: Eve channel entrypoints.
- `agent/lib/`: import-only runtime contracts and shared helper code.
- `agent/tools/`: typed tools for setup, repository materialization, docs
  workflows, diffs, checks, and approved writeback.
- `agent/skills/`: load-on-demand procedures such as the watched repository
  scan workflow, plus future docs impact, style discovery, patch preparation,
  and review procedures.
- `.codex/skills/`: repo-local Codex workflow skills for contributors, separate
  from Eve runtime skills.
- `agent/sandbox.ts`: Eve sandbox configuration with local `microsandbox`, Vercel
  Sandbox opt-in, and egress for GitHub repository materialization plus locked
  package installation.
- `evals/`: Eve evals and typed scenario fixtures for scenario-backed
  documentation decisions.
- `docs/MANIFEST.md`: product stance, MVP boundaries, principles, and success
  signals.
- `docs/REPOSITORY_MODEL.md`: working docs repository, context repository,
  external context, sandbox, and provenance contract.
- `docs/USER_TESTING.md`: manual user-test scenarios and acceptance criteria.
- `docs/ROADMAP.md`: milestone order, issue dependencies, and later work.
- `AGENTS.md`: rules for coding agents working in this repo.

Eve is filesystem-first, so new runtime capabilities should live in the
conventional Eve slots instead of a parallel custom layout. The installed Eve
docs under `node_modules/eve/docs/` are the source of truth for those slots.

## Run Locally

Use Node 24.18.0. The repository pins the local version in `.node-version`, and
`package.json` engines tell Vercel which runtime to use. If your shell does not
switch automatically when you enter the directory, run `fnm use` before
`pnpm install` or `pnpm dev`.

```sh
pnpm install
pnpm check
pnpm eval --list
pnpm eval saleor-docs-user-tests --skip-report
```

By default the agent uses the Vercel AI Gateway model configured in
`EVE_GATEWAY_MODEL`, or `zai/glm-5.2` when unset. To try another Gateway model,
set `EVE_GATEWAY_MODEL` to any model id available in the Vercel AI Gateway
catalog:

```sh
EVE_GATEWAY_MODEL=anthropic/claude-sonnet-5 \
pnpm eval saleor-docs-user-tests --skip-report --verbose
```

Development server:

```sh
pnpm dev
```

Local development uses `microsandbox()` by default. To test with hosted Vercel
Sandbox locally, run:

```sh
EVE_SANDBOX_BACKEND=vercel pnpm dev
```

Production-style start:

```sh
pnpm start
```

`pnpm check` is the handoff gate. It runs typecheck, Eve build, and repository
policy checks.

Workspace setup is stored in `.docs-maintainer/config.json`, which is ignored by
Git. Delete `.docs-maintainer/` to test first-run onboarding locally.
