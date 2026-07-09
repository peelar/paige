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

The current slice proves the GitHub docs-repository loop, watched-release
intake, and explicit Slack thread intake. Linear and broader signal handoff work
are tracked in `docs/ROADMAP.md` and GitHub issues.

## Run Locally

Use Node 24.18.0.

```sh
pnpm install
pnpm eval
pnpm dev
```

Local setup persistence uses a Drizzle/libSQL SQLite file at
`.docs-agent/docs-agent.sqlite` when `DOCS_AGENT_DATABASE_URL` is not set. In a
deployed runtime, set `DOCS_AGENT_DATABASE_URL` and, when required by the
provider, `DOCS_AGENT_DATABASE_AUTH_TOKEN`; otherwise setup persistence fails
visibly before docs work continues.

Slack intake uses Eve's Slack channel and Vercel Connect credentials. Set
`DOCS_AGENT_SLACK_CONNECTOR` to the Slack Connect client UID, or create the
default `slack/docs-agent` connector and attach its trigger to `/eve/v1/slack`.
The channel handles explicit app mentions and DMs, fetches thread context since
the last agent reply, and records Slack threads as docs signals instead of
reading channels ambiently.
