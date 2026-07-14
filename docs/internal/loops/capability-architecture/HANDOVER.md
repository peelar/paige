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
- #83 - Assumed: a sourced answer, abstention, or gap recommendation remains
  ephemeral by default; an explicit later request may create existing docs-work
  state while retaining inspected source ids, refs or revisions, paths or URLs,
  evidence classes, and uncertainty in ordinary provenance fields.
- #83 - Blocker: the seven workspace-knowledge answer eval cases are committed
  and deterministically discovered, but the inherited Eve microsandbox
  session-start blocker is unchanged. Do not retry without a concrete fix; keep
  #83 open until the live answer, abstention, no-mutation, and continuation proof
  can execute.
- #84 - Assumed: explicit manual docs work may use a server-labelled
  `external-context` or `manual-scenario` source with an operation key, while
  Slack and Linear identities remain exclusive to their provider-admission
  adapters; evidence linking preserves lifecycle and uses `updatedAt` as its
  optimistic revision token.
- #84 - Blocker: the migrated quick, substantial, correction, park/resume,
  follow-up, internal-document, and terminal-outcome eval definitions are not
  executed while the inherited Eve microsandbox session-start blocker remains
  unchanged. Keep #84 open until that live proof can run through the supervised
  evaluator.
- #85 - Assumed: an approval resume is available only to the original verified
  human initiator through the Eve Vercel OIDC runtime, for the exact approved
  session, run, call, and tool, while schedule and watch principals can never
  inherit that authority. Watch execution re-reads the opaque reservation and
  exact effective grants before every tool call.
- #85 - Blocker: the deterministic capability matrix, replay build, compiled
  manifest inspection, and complete repository gate pass, but the required
  live Slack, Linear, Eve, schedule, watch, and approval eval matrix was not
  executed because the Eve microsandbox session-start blocker is unchanged.
  Keep #85 open and do not retry until that cause changes.
- Runtime diagnosis - The freeze occurs after eval discovery and server health,
  inside Eve's microsandbox binding while awaiting sandbox readiness. The
  current manifest has no bootstrap or seeded workspace content, so Eve sets no
  template key and takes its direct image-backed `.image(...)` path rather than
  snapshot restore. No model request, tool call, repository clone, or eval
  assertion starts. A fresh run-owned `MSB_HOME` reproduced the failure with
  both microsandbox 0.5.10 and a coherent exact 0.5.5 Eve peer and native
  runtime, so retained global state, snapshot restoration, and the 0.5.10
  upgrade are not the cause. Both probes stopped after 120 seconds without
  semantic progress and removed their processes, sandboxes, and temporary
  state. Eve 0.23 exposes no supported alternate sandbox-startup mode; the next
  diagnostic belongs upstream rather than in another Paige eval retry.
- #86 - Assumed: the still-live repository-scenario decision mappings remain
  documented until their eval-fixture and writeback consumers are removed in
  #88. Setup and situational skills describe available surfaces and procedures
  but cannot add authority beyond the dynamic resolver and executor checks.
- #86 - Blocker: instruction boundaries, eval discovery, capability inventory,
  brand checks, `pnpm check`, and `pnpm check:full` pass, but the identity,
  behavior-settings, skill-routing, general-answer, and docs-work evals cannot
  run through the snapshot-backed session-start failure. Keep #86 open until
  that live proof can execute.
- #60 - Assumed: `rawObservationSeconds` is the hard boundary for a durable
  dispatch handoff, not a lower bound that the runtime may extend. A handoff
  lease is therefore capped by both ten minutes and its remaining raw retention;
  up to three attempts occur only when the approved retention permits. Ack or
  terminal completion clears the handoff immediately, and expiry fails it and
  clears content without another attempt. At zero retention no raw handoff is
  stored: the exact just-prepared value has one metadata-deadline claim, while
  release, crash expiry, or a missed deadline fails without durable retry.
- #60 - Assumed: provider delivery is restricted to the effective watch's exact
  verified Slack workspace and source channel. The model supplies content only;
  mode, target, budget, digest membership, retry lease, and provider idempotency
  key remain server-owned. `[[SILENT]]` suppresses the ordinary watch-turn reply
  and is not itself provider delivery. A frozen digest batch fails atomically if
  any member loses authority, so one provider key never represents new content.
- #60 - Assumed: effective revisions without an exact `providerWorkspaceId`
  cannot be granted watch authority and must be replaced by a newly approved
  proposal; the runtime does not infer or backfill provider identity.
- #60 - Blocker: deterministic runtime, capability, migration, adapter, and
  retry-race proof can run locally, but live watch eval proof is not attempted
  while the diagnosed Eve microsandbox session-start blocker remains unchanged.
  Do not retry the live evaluator without a concrete upstream startup fix.
- #77 - Assumed: continuity is materialized on the first occurrence whose exact
  revision grants `docs_work.manage`, uses that revision's `auditDays` as its
  finite retention, stays attached to the stable watch across replacement
  revisions, and cannot be archived or redirected by an active watch turn;
  Blocker: the read, update, revise-in-place, and no-op eval is committed but was
  not executed because the Eve microsandbox session-start blocker is unchanged.
