# Repository boundary

All configured repositories use one authenticated shallow Git cache under
`/workspace/repositories`.

- `configuration/` owns the agent's repository setup. The active configuration
  is durable and shared across channels; an unconfirmed proposal stays in the
  conversation until the user confirms it.
- `configuration/resolver.ts` turns that active setup into the bounded catalog
  used by repository tools. One repository has the `documentation` role and
  any others have the `evidence` role.
- Setup accepts GitHub URLs, normalizes duplicates, validates the exact
  repositories and required access, and activates a proposal only after
  explicit confirmation.
- `config.ts` resolves model-facing repository IDs only from that active
  catalog, so later tool calls cannot supply arbitrary origins.
- `SandboxGit` owns sandbox Git commands, cache initialization, and temporary
  GitHub firewall access. Eve binds the sandbox to turn cancellation, so the
  Git boundary does not carry a separate abort signal. GitHub App tokens are
  brokered at the firewall and never enter commands, remotes, or tool results.
- `shared/github.ts` uses unauthenticated GitHub access for verified public
  evidence repositories. Documentation and private evidence repositories use
  a GitHub App token with only the permissions their role needs.
  `createGitHubRequest` binds optional authentication and Eve's turn
  cancellation to the HTTP transport. GitHub's verified visibility also
  decides Git transport: public repositories fetch without credentials, while
  private repositories receive the scoped token through the sandbox firewall.
- GitHub rate-limit responses remain distinct repository errors with retry
  timing. They must not be reported as missing repositories or missing app
  access.
- `RepositoryFiles` in `files.ts` lists, searches, reads, and compares files
  at commits directly from Git objects, so read operations do not need a
  populated working tree.
- `service.ts` exposes those bounded read operations through the
  `repository_read`
  Eve tool.
- `metadata/` exposes bounded releases, open issues, tags, and recent commits
  through the `repository_metadata` Eve tool. These calls
  use GitHub's API from the trusted app runtime and never acquire a sandbox.
- `pull-requests/` exposes pull request summaries, details, changed-file
  metadata, conversation comments, review summaries, and inline comments
  through the `pull_request_read` Eve tool. It returns exact base and head
  commit SHAs for optional source inspection through `repository_read`, but it
  never acquires a sandbox itself or reads CI/CD checks.
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
