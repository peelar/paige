# Docs Maintainer Agent

An Eve-based agent for keeping docs-as-code repositories aligned with software
changes.

The agent is meant to behave like a documentation maintainer: inspect the code
change and surrounding context, decide whether docs are affected, explain the
impact, and only then prepare a small reviewable docs patch when the evidence
supports it.

The first runnable version is scenario-first. It will use PR-like changes,
GitHub-hosted Docusaurus-style working documentation repositories cloned or
materialized into the Eve sandbox, structured context fixtures, and approved
GitHub writeback before wiring Slack, Linear, Notion, Discord, or Vercel Connect
access.

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
- `agent/channels/`: Eve channel entrypoints.
- `agent/lib/`: import-only runtime contracts and shared helper code.
- `agent/tools/`: future typed tools for inspecting scenarios, repos, diffs,
  docs trees, and checks.
- `agent/skills/`: future load-on-demand procedures for docs impact analysis,
  style discovery, patch preparation, and review.
- `agent/sandbox.ts`: Eve sandbox configuration with local `microsandbox`, Vercel
  Sandbox opt-in, and GitHub-only egress for repository materialization.
- `evals/`: future Eve evals for scenario-backed documentation decisions.
- `docs/MANIFEST.md`: product stance, MVP boundaries, principles, and success
  signals.
- `docs/REPOSITORY_MODEL.md`: working docs repository, context repository,
  external context, sandbox, and provenance contract.
- `docs/ROADMAP.md`: milestone order, issue dependencies, and later work.
- `AGENTS.md`: rules for coding agents working in this repo.

Eve is filesystem-first, so new runtime capabilities should live in the
conventional Eve slots instead of a parallel custom layout. The installed Eve
docs under `node_modules/eve/docs/` are the source of truth for those slots.

## Run Locally

Use Node 24. The repository pins the expected version in `.node-version`. If
your shell does not switch automatically, run `fnm use` first or prefix commands
with `fnm exec --using 24.18.0`.

```sh
pnpm install
pnpm build
pnpm typecheck
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

`pnpm build` runs `eve build`. `pnpm typecheck` runs `tsc`.
