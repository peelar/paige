# ADR-0002: Use Separate Eve And Next.js Apps In A Turborepo

Status: Accepted
Date: 2026-07-10
Supersedes: None

## Context

Paige currently runs as one Eve application at the repository root. The
next product surface is an authenticated web control plane for setup readiness,
the docs-signal queue, signal evidence, and later operator workflows.

Eve can be mounted beside a Next.js frontend in one application. That is useful
for a chat UI, but it would make the operator app and durable agent runtime one
deployment and ownership boundary. The two surfaces have different concerns:
the agent owns channels, tools, sandboxes, evals, and durable turns; the web app
owns authenticated pages, product read models, and operator actions.

The repository also needs one validation command and a deliberate place for
database and product services used by both applications.

## Decision

Convert the repository to a pnpm and Turborepo monorepo with two independently
deployable applications:

- `apps/agent` contains the existing Eve runtime;
- `apps/web` contains the Next.js operator control plane;
- app-owned packages are added under `packages/` only when both applications
  need the code.

Root development and validation commands run through Turborepo. `pnpm check`
is the fast affected-package feedback loop; `pnpm check:full` remains the
complete repository handoff gate.

The expected first shared boundary is database and control-plane services. The
web app consumes typed server-side services rather than importing raw agent
tools or database tables. The agent remains the owner of Eve runtime behavior
and sandboxed repository work.

## Options Considered

- Keep the Eve-only repository and defer the web app: smallest structure, but
  it leaves durable product state without an operator surface.
- Mount Eve and Next.js as one application: simpler same-origin wiring, but it
  couples independent runtime, authentication, deployment, and ownership
  concerns.
- Use separate apps in a Turborepo: adds workspace and deployment configuration,
  but makes the boundary explicit while preserving shared code and one repo gate.

## Consequences

- The existing Eve app must move without behavior changes before UI work starts.
- The Next.js app can evolve without becoming the agent runtime.
- Authentication and cross-app calls must be explicit; same-origin access is
  not assumed.
- Database schema, migrations, and shared services need one clear package owner.
- Vercel deployment and environment configuration must identify which app owns
  each route, secret, and build.
- The monorepo conversion should stay structural. It must not extract speculative
  packages or combine unrelated runtime changes.

## Links

- [Admin UI plan](../ADMIN_UI.md)
- [Project roadmap](../ROADMAP.md)
- [GitHub issue #35](https://github.com/peelar/docs-agent/issues/35)
- Installed Eve Next.js guidance: `node_modules/eve/docs/guides/frontend/nextjs.mdx`
