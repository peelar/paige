# Local Development

Use Node 24.18.0 (see `.node-version`) and open the cloned repository in Codex.
Run:

```text
$setup
```

The workspace skill installs dependencies, migrates the local database, asks
only for missing workspace choices, validates repository access, and guides the
browser consent that GitHub, Vercel, Slack, or Linear must receive from a
person. It then reports readiness from Paige's canonical setup service.

The skill ships in `.agents/skills/setup`. To install it before cloning Paige:

```sh
npx skills add peelar/docs-maintainer-agent --skill setup --agent codex --yes
```

Start Paige's agent and operator UI together with `pnpm dev`. Use
`pnpm dev:agent --no-ui` or `pnpm dev:web` to run one app by itself.
The shared Portless proxy exposes the operator UI at
<http://paige.localhost:1355> and Eve at
<http://agent.paige.localhost:1355>, regardless of their assigned internal
ports.
Reset every local database, credential, connector link, and Eve runtime artifact
with `pnpm prune:local`; it stops Paige dev processes but never discards source
changes.

Use `pnpm check` while editing. It lints the repository, then typechecks and
runs deterministic Vitest suites only for affected packages. Turborepo caches
unchanged work, and pnpm uses the Node 24.18.0 runtime declared in
`devEngines` even when the ambient shell uses another Node version.

Before handing over code changes, run `pnpm check:full`. That command owns the
complete gate: lint, every typecheck and deterministic test, production builds,
the Playwright browser suite, workspace discovery and migration smoke, and the
local status smoke. Install Playwright's browser once if prompted:
`pnpm --filter @docs-agent/web exec playwright install chromium`.

Useful focused commands:

```sh
pnpm test
pnpm --filter docs-agent test:watch
pnpm --filter @docs-agent/control-plane test:watch
pnpm test:e2e
pnpm lint:fix
```

See [Deployment](./DEPLOYMENT.md) for production-specific setup.
