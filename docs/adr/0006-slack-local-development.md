# ADR-0006: Slack local development

Status: Accepted
Date: 2026-07-21

## Context

Slack behavior was tested against the production Paige deployment. This
exercised the real integration, but temporary Vercel deployments made small
runtime changes slow to verify. A temporary tunnel would remove the deployment
but either require a paid stable hostname or repeated Slack configuration.

Slack Socket Mode avoids public ingress and is supported by the underlying
Chat SDK adapter. It is not currently a direct fit for Paige: Eve's Chat SDK
bridge dispatches messages while handling its HTTP route, so direct socket
events would require a forwarding sidecar or a framework change.

## Decision

Run a dedicated **Paige (Preview)** Slack app against the local Eve agent on the
`paige` exe.dev VM. The documented exe.dev HTTPS proxy exposes the agent's
fixed port 3000 at:

```text
https://paige.exe.xyz/eve/v1/slack
```

The preview app is separate from the production Vercel Connect app and is
invited only to a dedicated private preview channel. Its bot token and signing
secret live in the app-owned, ignored `.env.preview.local`. Production
connector credentials remain the default; the explicit
`pnpm dev:slack-preview` command selects preview credentials and fails when
either value is missing.

## Consequences

- Slack exercises the real signed webhook and payload path without a deploy.
- The Slack request URL remains stable across dev-server restarts and code
  changes.
- Production and local agents cannot consume the same app event.
- The public proxy exposes the Eve server, whose session routes retain their
  normal authentication while the Slack route verifies Slack signatures.
- Port 3000 must remain dedicated to Paige while the VM proxy is public.
- Preview uses Paige's normal shared database and integrations. It isolates
  Slack ingress, not downstream tool side effects.
- Socket Mode remains a possible future option if Eve gains a direct dispatch
  context or Paige adds a justified, reusable forwarding boundary.
