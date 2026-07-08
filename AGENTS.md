# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use <https://eve.dev/docs> as a fallback.

## Planning

- GitHub Issues are the executable backlog and completion source of truth.
- Read `docs/MANIFEST.md` before product or positioning changes.
- Read `docs/ROADMAP.md` before selecting implementation order.
- Read relevant ADRs in `docs/adr/` before touching related architecture or
  product contracts.

## Rules

- Do not add fail-open stubs or silent fallbacks that make broken required
  integrations look successful.
- Before handing work over, run the repo validation command (`pnpm check`). Keep
  all required validators wired into that command instead of relying on separate
  remembered steps.
