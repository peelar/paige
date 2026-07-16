# Paige

This project uses Eve. Before writing runtime code, read the relevant guide from
the installed `eve` package under `node_modules/eve/docs/`.

## Rules

- Do not add fail-open stubs or silent fallbacks for required integrations.
- Prefer general agent tools over workflow-specific, one-time tools.
- Use `pnpm check` while working and `pnpm check:full` before handoff.
- Use targeted Eve evals only after model-visible behavior changes.
- Don't use export defaults and avoid barrel files.
- Avoid "lib" like plague. Collocate, think in modules.
- Once a scope is complete, propose a conventional commit message and end with
  `Commit? [Y/n]`.
