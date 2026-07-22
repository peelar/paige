---
name: setup
description: Prepare this repository checkout for local coding and verification. Use when a coding harness starts work in a fresh Paige checkout, when local development is not configured, or when dependencies, linked Vercel environment values, the shared Turso database, or local runtime access need to be repaired and verified.
---

# Set up local development

Prepare the coding harness's checkout. This is development infrastructure for
the coding agent, not a skill exposed to the Paige runtime.

## Workflow

1. Work from the repository root. Confirm its `package.json` name is
   `paige-workspace`.
2. Check for `.vercel/project.json`. When the checkout is not linked, ask the
   user which Vercel project to link before running `pnpm dlx vercel link`.
3. Run the deterministic provisioner:

   ```sh
   pnpm exec node .agents/skills/setup/scripts/setup.mjs
   ```

   It installs dependencies and pulls the linked production environment into
   a temporary file without printing values. It maps the Vercel-provided Turso
   variables, verifies the remote connection, writes app-owned local
   environments, and applies committed database migrations:

   - `apps/agent/.env.local` contains the database, agent connectors, and model
     access values.
   - `apps/web/.env.local` contains the database values plus the production
     agent URL and server-only Vercel identity used by the operator application.

   Shared values are intentionally repeated. Never create a root `.env.local`;
   each app must load only its own environment. The provisioner removes the
   temporary pull before starting connector setup. It then lists Slack
   connectors linked to the Vercel project and reuses the single Paige
   connector. If none is linked, it reuses a matching team connector or creates
   a managed Slack connector branded with Paige's README icon, attaches the
   project with triggers at `/eve/v1/slack`, and starts the Slack installation
   flow. A paused Slack installation must not undo the completed database
   setup. Slack sends inbound events directly to Paige, so the pulled
   `PAIGE_SLACK_SIGNING_SECRET` is required alongside the Connect connector
   used for outbound bot credentials.
   Runtime requests never create tables; `pnpm db:migrate` is the same explicit
   migration command when operating outside this setup flow.
4. If the provisioner opens Vercel Connect, tell the user to finish the Slack
   installation in the browser. Pause, then rerun the provisioner. Do not ask
   the user to copy a workspace ID or bot token.
5. Run `pnpm check`. Fix failures instead of bypassing required integrations.
6. Report what was configured without printing tokens. Tell the user that
   `pnpm dev` starts the local operator app connected to the production agent.

Require the shared Turso database. Accept `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`, or their legacy `DOCS_AGENT_DATABASE_*` names, from the
linked Vercel project. Never replace a missing remote database with a local
fallback. One database belongs to one agent; do not add tenant partitions.
