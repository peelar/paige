# Repository boundary

All configured repositories use one authenticated shallow Git cache under
`/workspace/repositories`.

- `config.ts` is the fixed catalog. Repository IDs resolve to configured GitHub
  coordinates and a role; the model cannot supply arbitrary origins.
- `SandboxGit` owns sandbox Git commands, cache initialization, and temporary
  GitHub firewall access. Eve binds the sandbox to turn cancellation, so the
  Git boundary does not carry a separate abort signal. GitHub App tokens are
  brokered at the firewall and never enter commands, remotes, or tool results.
- `shared/github.ts` resolves one GitHub App token through the configured
  documentation-repository installation. `createGitHubRequest` binds that
  token and Eve's turn cancellation to the HTTP transport; `GitHubRepository`
  then exposes repository operations without credential or cancellation
  parameters. GitHub's verified repository visibility decides Git transport:
  public repositories fetch without credentials, while private repositories
  receive the shared token through the sandbox firewall.
- `RepositoryFiles` in `files.ts` lists, searches, reads, and compares files
  at commits directly from Git objects, so read operations do not need a
  populated working tree.
- `service.ts` exposes those bounded read operations through the
  `repository_read`
  Eve tool.
- `metadata/` exposes bounded releases, open issues, open pull requests, tags,
  and recent commits through the `repository_metadata` Eve tool. These calls
  use GitHub's API from the trusted app runtime and never acquire a sandbox.
- `documentation/` creates one protected editable worktree, exposes bounded
  text edits and diff inspection, binds approval to a digest of the exact
  proposed bytes, creates an exact local approval commit, then publishes one
  atomic GitHub commit and draft PR from the trusted app runtime. The remote
  commit is re-read and matched to the approved digest before success.

The role is the authority boundary:

- `evidence` repositories can be fetched and inspected but never enter a
  writeback workflow.
- the `documentation` repository may use a working tree. Local edits never
  publish; remote commit and draft-PR operations live in a separate Eve tool
  that always requires explicit approval.
