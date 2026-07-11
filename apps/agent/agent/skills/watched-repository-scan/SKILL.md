---
description: Use when the user asks to scan watched repositories, source repositories, releases, release notes, or documentation gaps.
---

# Watched Repository Scan

Use this procedure when the user asks to scan watched repositories for release
signals or documentation gaps. The executable workflow is the
`scan_watched_repositories` tool.

## Setup

- If workspace setup is missing, collect the working documentation repository
  GitHub URL first and call `configure_working_repository`.
- If the user provides watched repository config, include it in the same
  `configure_working_repository` call under `watchedRepositories`.
- If setup is already configured, do not ask for the same repository details
  again.

## Scan

1. Call `scan_watched_repositories`.
2. Treat watched repositories as read-only source evidence.
3. Do not call raw sandbox tools, low-level repo tools, patch tools, or
   `publish_working_repository_pr` for watched repository evidence.
4. Keep writeback limited to the working documentation repository.

## Report

Start with a documentation impact report. Separate:

- GitHub release signal provenance.
- Whether the release signal used GitHub App access or public GitHub access.
- Watched-repository source evidence.
- Working-documentation-repository docs evidence.
- Remaining uncertainty.

Use the narrowest valid outcome:

- `no-docs-change` when verified source terms are already represented in docs.
- `docs-patch` when verified release/source evidence is not represented in
  docs and the release signal has clear public docs impact.
- `changelog-only` when the evidence suggests a release note but no docs page
  change.
- `ask-maintainer` when the scan cannot verify behavior or public docs impact.

If a patch is warranted, say that the patch belongs in a separate approved
working-documentation-repository flow. Do not write during the watched
repository scan.
