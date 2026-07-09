# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use <https://eve.dev/docs> as a fallback.

## Rules

- Do not add fail-open stubs or silent fallbacks that make broken required
  integrations look successful.
- Before handing work over, run the repo validation command (`pnpm check`). Keep
  all required validators wired into that command instead of relying on separate
  remembered steps.
- Once a scope of work is complete, propose a commit message following conventional commit message conventions. End with "Commit? [Y/n]".
- We'll be often using peelar/saleor-docs as the working documentation repository. It is our dogfooding project. Avoid overfitting to this repository. It's only an example we need to generalize from.
