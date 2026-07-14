---
name: docs-maintenance
description: Always load before a documentation-impact or working-repository workflow. Use when asked to investigate documentation impact, verify whether docs need to change, prepare or revise documentation, or produce a checked documentation diff.
---

# Docs Maintenance

## Route the work

1. Follow the current dynamic setup instructions. Reuse configured setup.
2. Establish the requested reader outcome, change context, source evidence, and
   likely documentation surface.
3. Inspect the working documentation repository before deciding. Compose the
   `working_repository` list, search, and line-range read modes around the
   evidence the task actually needs. Materialization is implicit.

## Decide and author

- Verify relevant current pages and nearby conventions. A no-change conclusion
  still needs repository evidence and a clean diff.
- Use `working_repository` validators mode only for optional inspection. When a
  check is requested, pass its named id directly to `run_validators` instead of
  substituting status or diff. `run_validators` is atomic read-only inspection:
  it discovers and persists the current source-bound trusted profile, executes
  only requested ids from that profile, accepts no command, and does not mutate
  the repository. Inspect status and the bounded draft diff through the same
  capability.
- Preserve release scope. When evidence introduces behavior in a patch release
  but the target page covers a broader release line, make the version boundary
  explicit instead of implying the behavior existed in every earlier patch.
- Use `get_docs_profile` before writing.
- Record the smallest reader-solving choice with `docs_work_manage` using the
  typed `decide` operation.
- Keep localized changes inline. For substantial work, keep the originating
  signal and Eve session, use `docs_work_manage` to start and update the
  original work, and record a typed `plan` before drafting.
- Use `authoring_workspace` for every localized, signal-backed, or multi-file
  draft. Take each update hash from the full-file `contentHash` returned by
  `working_repository` read; use `createOnly` only for a new target. Link a
  verified signal when it originated the draft. Link owned work and the ready
  content plan for substantial work. A revised plan makes the active draft
  stale: abandon that draft by id, replan, and author again.
- Prepare checks and the exact diff through the same authoring draft. Inspect a
  failed structured batch result before retrying. Do not call the authoring
  capability for read-only investigation or when no documentation change is
  requested.
- Stop when evidence or a consequential product decision is missing.

## Report and publish

Report the decision, evidence, pages considered, checks, changed files or clean
diff, and remaining uncertainty. Sandbox drafting needs no approval. Publishing
always requires explicit approval through `publish_working_repository_pr`.
Publication derives any signal relation from the prepared draft; do not attach
a different signal during writeback.
