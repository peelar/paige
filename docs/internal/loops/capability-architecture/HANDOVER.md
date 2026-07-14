# Handover

- #79 - Assumed: the executable EditorJS case preserves the original Slack
  thread as attached provenance through the Eve user-test surface; provider
  admission and thread continuation remain complementary Slack coverage.
- #79 - Gap: the repo-local `.workflow-data` journal contains stale active runs
  and hit `EMFILE` during Eve development snapshot pruning. Live proof used an
  isolated `WORKFLOW_LOCAL_DATA_DIR`; all four strict behavior cases passed.
- #80 - Assumed: package scripts in the operator-configured working repository
  are trusted validator sources only after typed discovery and source-hash
  binding; documented checks add provenance but never become executable model
  input.
- #81 - Assumed: `expectedContentHash` is the lowercase SHA-256 of the complete
  raw file bytes returned by canonical repository inspection, including binary
  files; `createOnly` is an explicit assertion that a target does not exist.
- #81 - Gap: authoring preparation still records the bounded internal check
  aliases on the draft. Repository-owned validator results from #80 remain
  read-only inspection evidence rather than attachments to the prepared draft.
- #81 - Blocker: the supervised live eval discovered all four cases, but the
  first case timed out before any assertion while Eve repeatedly opened the
  microsandbox session. The run-owned processes and sandboxes were removed;
  do not retry without a concrete Eve session-start fix. Keep #81 open until
  live focused-patch, multi-file, correction, and failed-validation proof can
  execute.
- #82 - Assumed: context repositories default to source-code or merged-change
  evidence; maintainer-confirmed decisions require explicit configuration. If
  a GitHub connector is configured, token resolution fails closed instead of
  falling back to anonymous access.
- #82 - Blocker: the answer-only workspace-knowledge eval is committed and
  deterministically discovered, but was not executed because the inherited
  Eve microsandbox session-start blocker is unchanged. Keep #82 open until the
  live current-docs plus read-only-source proof can execute.
