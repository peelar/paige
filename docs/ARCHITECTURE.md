# Architecture

Status: Accepted
Last Reviewed: 2026-07-13

## Sources

- `docs/internal/MANIFEST.md`
- `docs/internal/ROADMAP.md`
- `docs/internal/REPOSITORY_MODEL.md`
- `docs/internal/CAPABILITIES.md`
- `docs/internal/ADMIN_UI.md`
- `docs/DEPLOYMENT.md`
- `docs/internal/adr/0001-docs-signal-persistence.md`
- `docs/internal/adr/0002-turborepo-agent-and-web-apps.md`
- `docs/internal/adr/0004-policy-bound-watches.md`
- `docs/internal/adr/0005-one-database-per-agent.md`
- `docs/internal/adr/0006-stable-capability-families.md`
- Installed Eve security, authentication, durability, and multi-tenant pattern
  documentation under `node_modules/eve/docs/`
- Turso Platform API and database-token documentation

## Product Frame

Paige is one durable documentation agent with an operator surface, provider
channels, sandboxed repository work, and app-owned state. The current product is
not a multi-tenant SaaS control plane. Its deployment and persistence contracts
must nevertheless preserve the accepted long-term isolation boundary: every
agent owns one database, and no other agent can read or write that database.

## Technical Context

Paige runs as separate Eve and Next.js applications backed by shared typed
control-plane services. Eve owns durable sessions, channels, schedules, tools,
and sandboxed execution; Paige owns product persistence and authorization
around those surfaces. Eve route authentication identifies a caller but does
not provide cross-tenant session ownership automatically, so a future shared
runtime must enforce agent ownership before session creation, continuation, or
streaming. Turso can provision databases and database-scoped tokens, but that
future provisioning layer is not part of the current product.

## Architecture Thesis

The agent is Paige's product-state isolation unit. One current Paige deployment
contains one agent, and its Eve app and paired operator app use exactly one
agent-owned database selected through server-side deployment configuration.
`workspace_id` partitions domain state inside that database; it is not a tenant
authorization mechanism and must not be used to mix multiple agents into one
database. If Paige later becomes a SaaS, multiple agents may share application
runtime, but every request must first resolve an authenticated agent context and
then bind to that agent's exclusive database. The SaaS registry, provisioning
layer, and tenant router are explicitly deferred.

## Capability Contract

Paige grants model authority through stable resource-and-effect families rather
than current tool names or scenario workflows. The accepted identifiers are:

- `knowledge.read` for bounded, provenance-bearing workspace evidence;
- `repository.read` for policy-aware configured-repository inspection and named
  read-oriented checks;
- `docs_work.manage` for durable documentation-work state;
- `draft.edit` for reversible working-documentation sandbox changes;
- `follow_up.schedule` for bounded signal-linked follow-up work;
- `provider.deliver` for policy-bound delivery to a preapproved provider target;
- `publication.publish` for approval-gated publication of a prepared working-
  documentation draft.

Capability identifiers are durable policy terms, not promises of availability.
Eve dynamic resolution may narrow the visible tool set from the verified
channel and principal, setup readiness, work state, and effective watch
revision. Every implementation still rechecks authorization and resource policy
inside execution.

A watch may grant only an approved subset of the first six families. It can
never grant `publication.publish`; publishing remains separately authorized and
requires explicit human approval on every call. Ignore and abstain are outcomes,
not capabilities. Workspace setup, workspace-memory governance, and provider
admission remain non-delegable control or adapter boundaries.

Documentation is Paige's only mutable product domain. Provider delivery is a
separate external side effect: it may send an allowed result under an approved
target, delivery policy, idempotency key, and budget, but it cannot mutate
documentation or stand in for publication approval. The exhaustive current and
planned migration is maintained in `docs/internal/CAPABILITIES.md`.

## System Context

### Users And Actors

- Operator: configures and reviews one agent through authenticated product
  surfaces; the operator never receives raw database credentials in the
  browser.
- Provider participant: reaches the agent through an admitted Slack, Linear,
  GitHub, or other provider event governed by that agent's provider policy.
- Paige agent runtime: performs durable reasoning, provider intake, scheduled
  work, and sandboxed repository operations for one agent.
- Paige operator app: reads and mutates the same agent's state through typed
  server-side services.

### In System

- One agent's setup, signals, memories, watches, runs, approvals, behavior,
  profiles, audit history, and Chat SDK operational state.
- Fail-closed database readiness, schema validation, and typed product services.
- Server-side database credentials for the current agent deployment.
- Authentication and authorization for the agent's current operator and
  provider surfaces.

### Out Of System

- SaaS organizations, agent provisioning, billing, agent switching, invitations,
  and roles.
- A registry that maps authenticated agent identities to database credentials.
- Cross-agent queries, analytics, search, memory, or workflow state.
- Automated migration or restore orchestration across a database fleet.

### External Dependencies

- Eve: durable agent runtime, sessions, schedules, channels, tools, and sandbox.
- Vercel and Vercel Workflow: deployment and durable execution infrastructure.
- SQLite/libSQL, with Turso as the likely managed deployment backend: the
  agent-owned application database.
- Vercel Connect and provider APIs: scoped provider credentials and events.
- GitHub: working documentation repository and approved writeback.

## Runtime Shape

The current runtime is one agent deployed as two cooperating server
applications:

```text
operator/provider request
          |
          v
  agent app or web app
          |
          v
 typed control-plane services
          |
          v
 one agent-owned database
```

The agent and web deployments must receive the same database URL and a
database-scoped credential because they are two surfaces of the same agent. A
different Paige agent must receive a different database and credential. No
browser input, provider payload, model tool input, workspace id, or tenant id
may select a database.

A future SaaS may replace the deployment-bound database selection with an
authenticated agent-store resolver inside a shared runtime. That change is not
authorized by this contract until agent membership, connector routing, Eve
session ownership, migration orchestration, and fail-closed database binding
are designed and implemented together.

## Primary Modules

- `apps/agent`: one agent's Eve runtime, channels, schedules, tools, skills,
  evals, and sandbox policy.
- `apps/web`: the authenticated operator surface for that same agent.
- `packages/control-plane`: schema, migrations, database client, typed product
  services, readiness, and browser-safe projections for one agent database.
- GitHub integration inside `packages/control-plane`: scoped validation, tokens,
  repository access, and approved writeback.

No current module is a SaaS registry, tenant router, or database provisioner.

## Data And State

- Agent product state: owned by one agent and stored in its app-owned
  SQLite/libSQL database.
- Workspace state: the canonical working-documentation configuration inside one
  agent database. The current `default` workspace id is an internal domain key,
  not a cross-agent tenant key.
- Eve session and workflow state: owned by Eve/Vercel Workflow and separate from
  the app-owned database. A future shared runtime must add application-owned
  agent ACLs around session creation, continuation, approvals, and streams.
- Provider credentials: server-side and scoped to the current agent's admitted
  provider surfaces; never model context or browser data.
- Repository contents: materialized into isolated Eve sandboxes and excluded
  from the product database except for bounded metadata and artifacts.

Deleting, exporting, restoring, or retaining one agent's product state must be
possible without reading or rewriting another agent's database.

## Integration Boundaries

- Database: control-plane services hide Drizzle/libSQL details from apps and
  model-facing tools. The current client is deployment-bound, not request-bound.
- Operator authentication: authorizes use of one deployed agent; it does not
  grant raw database access.
- Provider adapters: authenticate and admit events before they can wake the
  model or access agent state.
- Provider delivery: sends only to a policy-approved provider target and remains
  separate from documentation drafting and publication.
- Publication: accepts only a prepared checked draft for the configured working
  documentation repository and pauses for explicit approval on every call.
- Eve session routes: safe today because one runtime serves one agent; they
  require explicit agent ownership checks before a runtime can serve more than
  one agent.
- Turso management APIs: deferred to a future provisioning boundary. Platform
  credentials must never be added to the current agent or browser runtime.

## Current Fit And Divergence

The current code is correctly shaped for one deployment-bound agent. The same
choices become blockers, not reusable tenancy mechanisms, before a shared
runtime can serve multiple agents.

| Current shape | Current meaning | Requirement before shared runtime |
| --- | --- | --- |
| One module-global database client from environment variables | Correctly binds one deployment to one agent database. | Replace with an authenticated agent-store resolver and bounded per-agent clients. |
| `DEFAULT_WORKSPACE_ID = "default"` | Internal scope inside one agent database. | Keep workspace scope separate from agent authorization; never turn request input into a database selector. |
| One connector configuration per process | Correctly binds providers to one deployed agent. | Map verified provider installations to an agent before connector or database access. |
| One allowlisted operator workspace | Correct for the current product. | Add organizations, memberships, and selected-agent authorization outside agent databases. |
| One database migration during build | Correct for one configured database. | Add idempotent provisioning, schema-version tracking, and fleet migrations. |
| One Eve runtime's sessions and schedules | Correct because the runtime has one agent. | Enforce agent ownership for create, continue, stream, approval, callback, and scheduled fan-out paths. |

One current limitation remains explicit: Paige cannot detect that an operator
accidentally reused one database URL or token across two separately configured
agent deployments. Deployment review and database-scoped credentials enforce
the boundary today. A future non-SaaS hardening slice may add an immutable agent
identity record and startup assertion without adding tenant routing.

## Variability Contract

### Locked In

- One agent owns one application database.
- The agent runtime and its paired server-side operator app are the only Paige
  applications that receive that database's credential.
- No model-facing or browser-facing input selects database or agent scope.
- `workspace_id` is not a cross-agent security boundary.
- Persistence and authorization failures fail closed.
- Stable capability identifiers are resource-and-effect families and are not
  current tool names or scenario verbs.
- `publication.publish` is never grantable by a watch.

### Configurable

- The current agent's database URL and database-scoped authentication token.
- The working documentation repository, watched repositories, provider
  connections, behavior settings, watches, and policies stored for that agent.
- The approved subset of non-publication capability families on each effective
  watch revision.
- Local SQLite versus a deployed libSQL-compatible database.

### Extensible

- The app-owned persistence interface may support another SQLite/libSQL
  provider without changing agent workflows.
- Model-facing tools may be consolidated or resolved dynamically while
  preserving the stable capability-family and execution-policy contract.
- A future authenticated agent-store resolver may replace deployment-bound
  database selection while preserving database-per-agent isolation.

### Internal

- Drizzle query structure, connection reuse, migration implementation, indexes,
  and browser-safe read models.
- Model-facing tool names, skill choreography, and compatibility wrappers while
  they remain fully mapped in the checked capability inventory.
- The canonical workspace id while only one workspace exists inside an agent.

### Deferred

- The SaaS control plane and Turso database provisioning.
- Shared-runtime agent routing and connector installation routing.
- Organizations, memberships, invitations, roles, billing, and agent switching.
- Dedicated runtime deployments as an enterprise isolation option.

## Quality Attribute Scenarios

- Isolation: when a model, browser, or provider payload supplies a workspace,
  tenant, database, or agent identifier, the runtime ignores it for database
  selection and uses only the server-bound current agent database, verified by
  deterministic scope and tool-input tests.
- Least privilege: when Paige is deployed, each server app receives only the
  scoped credential for its agent database, verified by deployment review and a
  production readiness smoke.
- Failure safety: when database configuration, authentication, migration state,
  or schema is missing or invalid, durable workflows stop visibly, verified by
  `pnpm check` and readiness tests.
- Least authority: when a channel, principal, setup state, or approved watch
  revision cannot grant an operation, the model does not see or cannot execute
  it, verified by capability-matrix tests and execution-time denial tests.
- Publication safety: when a watch or scheduled turn requests publication, the
  runtime refuses it; only a prepared draft resumed through explicit human
  approval can publish, verified by approval and watch-policy tests.
- Browser privacy: when an operator opens a list or detail page, the browser
  receives a typed projection without database credentials or internal scope
  identifiers, verified by control-plane boundary checks.
- Future shared-runtime safety: when a change proposes serving multiple agents
  from one process, it cannot ship until database routing, connector routing,
  session ownership, schedules, and migrations all derive from authenticated
  agent context and fail closed.

## Fitness Checks

- `pnpm check:full` remains the handoff gate for database readiness, persistence
  failure, model-supplied scope rejection, server/browser package boundaries,
  and repository validation.
- `pnpm capability:check` compiles Eve's authored surface and fails when current
  tools, disabled framework tools, stable identifiers, or migration records
  diverge. Both `pnpm check` and `pnpm check:full` include it.
- Production deployment review verifies that the paired agent and web apps use
  the same database and that no other agent deployment uses its URL or token.
- New model-facing tools must not accept `agentId`, `tenantId`, `workspaceId`, a
  database URL, or a database token to choose persistence scope.
- Any change that adds request-time database selection, multiple agents in one
  database, or cross-agent data access must first update this contract and
  supersede ADR-0005.
- Any future shared-runtime issue must include tests for authenticated database
  binding, provider installation routing, Eve session ownership, and migration
  compatibility.

## Security And Privacy

- Database URLs and tokens are server-only secrets. They must not enter model
  context, tool output, browser bundles, client payloads, logs, or artifacts.
- A Turso deployment must use a token scoped to the one agent database rather
  than an organization-level management token.
- Operator and provider authentication grants application access for the
  current agent; it never grants direct database access.
- Cross-agent reads, writes, joins, memory, searches, session continuation, and
  provider delivery are prohibited.
- Working and watched repository authority remains independent from database
  access and preserves existing read/write boundaries.
- Dynamic capability visibility never replaces authorization inside the tool or
  service that performs the operation.
- Provider delivery requires verified target scope, idempotency, and budgets;
  publication additionally requires a prepared checked diff and explicit human
  approval on every call.

## Operational Contract

- A current installation provisions or selects one database before deploying
  the paired agent and web applications.
- Both applications use the same migrations and typed services against that
  database.
- A second agent requires a second database and a separately scoped credential,
  even when owned by the same person or organization.
- Backups, restore, export, retention, and deletion operate on one agent
  database at a time.
- Missing or unhealthy required persistence is a visible deployment and
  readiness failure; there is no local or shared-database fallback in production.

## ADR Candidates

- An immutable database-bound agent identity assertion if accidental credential
  reuse becomes a demonstrated operational risk.
- Shared-runtime authenticated agent routing when SaaS implementation is
  intentionally started.

## Open Questions

- Database identity assertion: defer until a focused hardening slice can choose
  an identifier lifecycle without inventing SaaS membership or provisioning.
- SaaS control-plane store: defer until the SaaS layer is explicitly in scope.

## Change Rules

- Update this file when a change alters module boundaries, data ownership,
  integration contracts, extension points, deployment shape, or quality
  guarantees.
- Use `$to-adr` for decisions that are costly to reverse, surprising without
  context, or the result of a real tradeoff.
- Keep implementation issues aligned with this contract before `$next` starts
  work.
