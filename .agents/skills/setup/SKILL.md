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
3. Pull the linked production environment, which contains the Turso database
   provisioned for this agent:

   ```sh
   pnpm dlx vercel env pull .env.local --environment=production --yes
   ```

   Do not print pulled values.
4. Run the deterministic provisioner:

   ```sh
   pnpm exec node .agents/skills/setup/scripts/setup.mjs
   ```

   It installs dependencies, maps the Vercel-provided Turso variables, and
   verifies the remote connection, and immediately writes Paige's local
   database variables to the root `.env.local`. This is the single local
   environment file shared by the workspace launchers. The provisioner then
   lists Slack connectors linked to the Vercel project and reuses the single
   Paige connector. If none is linked, it reuses a matching team connector or
   creates a managed Slack connector, attaches the project with triggers at
   `/eve/v1/slack`, and starts the Slack installation flow. A paused Slack
   installation must not undo the completed database setup.
5. If the provisioner opens Vercel Connect, tell the user to finish the Slack
   installation in the browser. Pause, then rerun the provisioner. Do not ask
   the user to copy a workspace ID or bot token.
6. Run `pnpm check`. Fix failures instead of bypassing required integrations.
7. Report what was configured without printing tokens. Tell the user that
   `pnpm dev` starts the local harness.

Require the shared Turso database. Accept `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`, or their legacy `DOCS_AGENT_DATABASE_*` names, from the
linked Vercel project. Never replace a missing remote database with a local
fallback. One database belongs to one agent; do not add tenant partitions.
