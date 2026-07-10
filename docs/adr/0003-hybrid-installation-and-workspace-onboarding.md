# ADR-0003: Split Installation From Workspace Onboarding

Status: Accepted
Date: 2026-07-10
Supersedes: None

## Context

Docs Agent needs both infrastructure setup and product setup. They cannot all
happen in the same place.

Slack, Linear, and GitHub app credentials are app-scoped. Their Vercel Connect
clients, provider installations, and webhook triggers must exist before those
channels can receive the first message or issue an app token. An agent cannot
install the Slack app required to deliver the Slack message that is supposed to
start onboarding.

Once one channel or web surface is reachable, Docs Agent can already collect
workspace configuration conversationally. The current setup gate persists the
working documentation repository and GitHub writeback state in the app-owned
database and asks for missing setup at turn start.

## Decision

Use one versioned setup model with a hybrid onboarding flow:

- installation onboarding is owned by an interactive installer, CLI, or browser
  handoff and makes the deployment, database, authentication, app-scoped
  connectors, provider installations, and webhook routes ready;
- workspace onboarding is available through both the authenticated web app and
  the agent once any surface can reach it;
- both interfaces call the same typed setup services and produce the same
  readiness result;
- progressive preferences such as personality, participation, memory review,
  schedules, and notifications come after the first useful docs signal.

Runtime OAuth prompts remain the path for user-scoped outbound connections in
an existing authenticated session. They are not treated as a bootstrap path for
app-scoped channel credentials.

Headless installation must stop with a concrete human action when provider or
browser consent is required. It must not report missing app installation as
successful setup.

## Options Considered

- Web-only onboarding: suitable for a hosted product, but it requires the web
  app to own deployment and connector provisioning before those management
  contracts are established.
- Agent-only onboarding: natural for workspace questions, but impossible for
  the app-scoped channel that must exist before the first message arrives.
- Hybrid onboarding over one setup model: preserves low-friction conversational
  setup without hiding the infrastructure bootstrap boundary.

## Consequences

- Readiness must distinguish installation, channel, and workspace failures.
- The web app and agent must not implement separate setup schemas or validation.
- Connector installation may initially link to Eve CLI, Vercel Connect, or the
  provider rather than being silently automated in the web app.
- Setup changes need auditability and explicit production authentication.
- The first web onboarding slice can be read-only readiness; guided mutations
  and connector handoffs can follow independently.

## Links

- [Admin UI plan](../ADMIN_UI.md)
- [Project roadmap](../ROADMAP.md)
- [ADR-0001: Persist Docs Signals In An App-Owned Database](./0001-docs-signal-persistence.md)
- [GitHub issue #39](https://github.com/peelar/docs-agent/issues/39)
- [GitHub issue #42](https://github.com/peelar/docs-agent/issues/42)
- [GitHub issue #43](https://github.com/peelar/docs-agent/issues/43)
- Installed Eve Slack guidance: `node_modules/eve/docs/channels/slack.mdx`
- Installed Eve connection guidance: `node_modules/eve/docs/connections/overview.mdx`
