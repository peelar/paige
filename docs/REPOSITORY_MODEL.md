# Repository Model

The agent works from one required **working documentation repository** and zero
or more evidence sources. The working documentation repository is the only
mutable target. Everything else is evidence for the documentation impact report.

## Working Documentation Repository

The working documentation repository is a GitHub-hosted docs-as-code repository
provided by URL, ref, and docs root. It is cloned or materialized into the Eve
sandbox at `/workspace/working-docs`.

The repository input contract captures:

- `source.type`: `github-url`.
- `source.url`: `https://github.com/<owner>/<repo>[.git]`.
- `ref`: branch, tag, or commit to inspect.
- `docsRoot`: repository-relative docs root, such as `docs` or `.`.
- `sandboxPath`: `/workspace/working-docs`.
- `accessMode`: `sandbox-write`.
- `allowedActions`: clone, read, search, patch, run checks, and export diff.
- `provenanceLabel`: `working-documentation-repository`.

Host local paths are not supported as repository sources for the main workflow.
Local development and production use the same sandbox-first contract: GitHub URL
to Eve sandbox to report, diff artifact, and approved GitHub writeback.

## Sandbox Boundary

`agent/sandbox.ts` uses `microsandbox()` by default for local development and
uses `vercel()` when deployed on Vercel. Set `EVE_SANDBOX_BACKEND=vercel` during
local development to test against hosted Vercel Sandbox explicitly.

Both supported backends enforce the same initial network policy: only GitHub and
GitHub content domains needed for repository materialization are allowed.
Package-manager, provider, and arbitrary internet egress are out of scope until
a later workflow explicitly requires them.

If the sandbox cannot be created, the repository cannot be cloned or
materialized, or the input uses an unsupported source such as a host local path,
the workflow must fail visibly. It must not fall back to a local checkout, stub
repository, fake diff, or false-success report.

## Context Repositories

Context repositories are optional future evidence sources. They are
GitHub-hosted repositories cloned or materialized into the sandbox with
`sandbox-read` access. They can support search, read, diff inspection, and
explicitly safe read-only checks, but they cannot receive patches, branches,
commits, draft PRs, or other write actions.

Context repository provenance must be labeled separately from working
documentation repository provenance.

## External Context

External context is structured non-repository evidence. It is not a loose plain
text blob. It preserves source shape, provenance, timestamps, authors, links,
and relationships.

Supported provider-neutral shapes are:

- `communication-thread`
- `issue-tracker-item`
- `decision-record`
- `release-note`
- `customer-report`

Provider-specific systems can map into these shapes later without becoming
first-class assumptions in the repository model.

## Example Input

```ts
{
  workingDocumentationRepository: {
    source: {
      type: "github-url",
      url: "https://github.com/org/docs-repo.git",
    },
    ref: "main",
    docsRoot: "docs",
    sandboxPath: "/workspace/working-docs",
    accessMode: "sandbox-write",
    allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff"],
    provenanceLabel: "working-documentation-repository",
  },
  contextRepositories: [],
  externalContext: [],
}
```

The TypeScript and Zod contract lives in `agent/lib/repository-contract.ts`.
