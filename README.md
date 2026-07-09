# Docs Agent

Add an agent that proactively takes care of your open-source project
documentation.

Docs drift because the truth is scattered across PRs, releases, Slack threads,
Linear issues, and support notes. Docs Agent follows those signals, checks the
real docs in a sandbox, and starts with an impact report: what changed, what it
inspected, what evidence it trusts, and whether the right move is a patch, no
change, changelog, or maintainer question. The important behavior is covered by
live Eve evals, so the product promise is something we can regression-test
instead of just prompt carefully.

When a patch is warranted, it prepares the smallest reviewable Markdown or MDX
diff, runs checks, and waits for approval before opening a draft PR.

The current slice proves the GitHub docs-repository loop; next comes Slack, Linear, and
watched-release intake. You can follow the progress in the `docs/ROADMAP.md` file or GitHub issues.

## Run Locally

Use Node 24.18.0.

```sh
pnpm install
pnpm eval
pnpm dev
```
