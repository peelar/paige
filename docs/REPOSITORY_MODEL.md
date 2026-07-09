# Repository Model

The agent works from one required **working documentation repository** and zero
or more evidence sources. The working documentation repository is the only
mutable target. Everything else is evidence for the documentation impact report.

## Working Documentation Repository

The working documentation repository is a GitHub-hosted docs-as-code repository
provided by URL. A ref and docs root may be provided, but they are not required:
the ref defaults to `main`, and the docs root is detected after the repository
is cloned or materialized into the Eve sandbox at `/workspace/working-docs`.

The repository input contract captures:

- `source.type`: `github-url`.
- `source.url`: `https://github.com/<owner>/<repo>[.git]`.
- `ref`: optional branch, tag, or commit to inspect. Defaults to `main`.
- `docsRoot`: optional repository-relative docs root, such as `docs` or `.`. If
  omitted, the workflow detects a Docusaurus-style docs root from the sandbox
  checkout.
- `sandboxPath`: `/workspace/working-docs`.
- `accessMode`: `sandbox-write`.
- `allowedActions`: clone, read, search, patch, run checks, and export diff.
  Approved GitHub writeback adds `publish-pr`.
- `provenanceLabel`: `working-documentation-repository`.

The active working repository configuration is session-scoped. Calling
`configure_working_repository` validates the repository input, materializes the
checkout in the sandbox, resolves the docs root, and records that state for later
repository workflow tools in the same session.

Host local paths are not supported as repository sources for the main workflow.
Local development and production use the same sandbox-first contract: GitHub URL
to Eve sandbox to report, diff artifact, and approved GitHub writeback.

## Approved GitHub Writeback

Writeback is available only for the configured working documentation repository.
The model-facing surface is the authored `publish_working_repository_pr` tool,
not generated GitHub API tools, raw sandbox git commands, or a context/source
repository operation.

The publish tool requires approval on every call. After approval, runtime code
uses an app-scoped Vercel Connect GitHub credential to create a branch, commit
the prepared sandbox diff, and open a draft PR. The credential stays in the
trusted runtime: it is not passed into the sandbox, model context, prompt, or
durable report artifact.

The tool publishes only the last prepared workflow diff. It refuses to publish
when there is no diff, checks failed or were not recorded, the sandbox diff no
longer matches the workflow result, the base branch moved, the publish branch
already exists, or the working tree contains staged, untracked, deleted, renamed,
copied, binary, or unsupported-mode changes.

## Sandbox Boundary

`agent/sandbox.ts` uses `microsandbox()` by default for local development and
uses `vercel()` when deployed on Vercel. Set `EVE_SANDBOX_BACKEND=vercel` during
local development to test against hosted Vercel Sandbox explicitly.

Both supported backends enforce the same initial network policy: GitHub and
GitHub content domains needed for repository materialization are allowed, and
the npm registry domains needed for locked dependency installation are allowed
so sandboxed docs checks can run. Provider and arbitrary internet egress remain
out of scope until a later workflow explicitly requires them.

Materialization may reuse an existing sandbox checkout when the remote matches
the requested working repository. It may also restore a matching template-scoped
repository cache when one was seeded by the sandbox bootstrap. Reuse still
resets tracked changes and cleans untracked non-ignored files before analysis.
If neither cache is available, or the checkout belongs to another repository,
the workflow clones a fresh copy.

Dependency installation uses a sandbox-local cache marker outside the working
repository. A cached install is valid only when `node_modules` exists, the
`pnpm-lock.yaml` hash matches, and the prior install marker records a passed
locked install for the same repository and ref. Repository checkout behavior
stays repository-generic: it only restores a cache if a matching marker exists.
Required checks such as git diff checks still run when the scenario requires
them.

If the sandbox cannot be created, the repository cannot be cloned, refreshed, or
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
  },
  contextRepositories: [],
  externalContext: [],
}
```

The TypeScript and Zod contract lives in `agent/lib/repository-contract.ts`.
