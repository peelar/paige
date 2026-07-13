# Paige

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use <https://eve.dev/docs> as a fallback.

## Rules

- Do not add fail-open stubs or silent fallbacks that make broken required
  integrations look successful.
- Use `pnpm check` for the fast affected-package feedback loop. Before handing
  work over, run the complete repo validation command (`pnpm check:full`). Keep
  all required handoff validators wired into that command instead of relying on
  separate remembered steps.
- Once a scope of work is complete, propose a commit message following conventional commit message conventions. End with "Commit? [Y/n]".
- We'll be often using peelar/saleor-docs as the working documentation repository. It is our dogfooding project. Avoid overfitting to this repository. It's only an example we need to generalize from.

## Identity Instructions

- Keep `apps/agent/agent/instructions/identity.md` deliberately small.
- Use short, plain sentences for permanent identity, tone, and cross-channel behavior only.
- Before changing it, search the other model-visible instructions, skills, tool descriptions, and channel context. Do not duplicate guidance from those surfaces.
- Do not put workflows, tool routing, examples, temporary requirements, or provider-specific behavior in `identity.md`.
- Prefer replacing or deleting an existing sentence over appending another one.
- Cover every behavior change in `identity.md` with an eval, or show that an existing eval already proves it.
