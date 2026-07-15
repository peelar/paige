# Contributing to Paige

Paige is being rebuilt from a deliberately small Slack direct-message baseline.
Before adding a tool, database table, channel behavior, or product workflow,
agree on the user interaction, authority boundary, and focused proof.

## Development

Use Node 24.18.0 and pnpm 11.12.0.

```sh
pnpm install
pnpm check
```

Before handing over a complete change, run:

```sh
pnpm check:full
```

See the [README](./README.md) and [manifest](./MANIFEST.md). Keep required
integrations fail-closed, and add a deterministic test or focused Eve eval for
behavior changes.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](./LICENSE).
