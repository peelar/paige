# Repository boundaries

- `evidence/` is the implemented read-only snapshot capability exposed through
  the `evidence_repository` Eve tool. Each configured repository explicitly
  selects public or GitHub App-authorized access.
- `documentation/` defines the future writable Git checkout and approved
  branch, commit, and draft-PR workflow. It is not a model-facing tool yet.
- `metadata/` defines future bounded GitHub API reads for releases, issues,
  pull requests, tags, commits, and revision comparisons. It is not a
  model-facing tool yet.
- `shared/` contains repository coordinates, typed errors, GitHub request
  primitives, and sandbox serialization that can be used by more than one
  repository capability.

Evidence snapshots must remain immutable and cannot be promoted into the
documentation writeback workflow.
