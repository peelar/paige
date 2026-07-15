# Paige

This project uses Eve. Before writing runtime code, read the relevant guide from
the installed `eve` package under `node_modules/eve/docs/`.

## Rules

- Do not add fail-open stubs or silent fallbacks for required integrations.
- Use `pnpm check` while working and `pnpm check:full` before handoff.
- Use targeted Eve evals only after model-visible behavior changes.
- Before changing product scope, persistence, connectors, or runtime boundaries,
  read `MANIFEST.md`.
- Once a scope is complete, propose a conventional commit message and end with
  `Commit? [Y/n]`.
