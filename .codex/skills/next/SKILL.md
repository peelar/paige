---
name: next
description: >-
  Repo-specific $next workflow for Paige. Use when the user
  writes "$next", says "next", or asks Codex to pick up the next GitHub issue
  in this repository. Inspect the ordered issue backlog, planning docs, repo
  instructions, Eve docs for changed runtime surfaces, and current main branch
  state before choosing one issue. Normally propose the smallest coherent slice
  and wait for approval. When the user explicitly activates loop mode with a
  bounded issue scope, implement and ship those issues without per-issue approval
  pauses. Verify each issue, and when agent behavior changes, add an executable
  eval or present an end-user scenario the user can run manually.
---

# Next

## Purpose

Use this workflow to pick and ship the next coherent Paige
backlog item. This repo does not use the global `$next` draft-PR publishing
loop. Work is intended to land directly on `main` after validation and explicit
commit approval.

GitHub Issues are the backlog source of truth. `docs/internal/ROADMAP.md` is the
fallback ordering source when GitHub Projects or custom priority fields are not
available.

## Loop Mode

Loop mode is an explicit exception to the normal design and commit approval
pauses. It does not weaken scope, dependency, validation, safety, or write
boundaries.

Activate loop mode only when the user's objective:

- explicitly says to run `$next` in loop mode;
- names this repository;
- names the exact allowed issue set, range, or ordered queue;
- names any exclusions; and
- authorizes implementation, commits, pushes, issue comments, and issue closure
  for that bounded scope without further approval.

Treat that objective as advance approval for each in-scope issue. Do not pause
for a design check, ask `Commit? [Y/n]`, or wait for approval between issues.
Still state the selected issue and intended slice briefly before editing so the
loop remains inspectable.

Before the first issue, require:

- `main` checked out with a clean worktree;
- local `main` aligned with `origin/main` after fetching;
- a self-contained, dependency-ordered queue with a verification mechanism for
  every issue; and
- no excluded or unrelated work in the selected issue's dependency path.

For each issue:

1. Re-read the live issue, current roadmap order, dependencies, and relevant
   repository contracts.
2. Implement only the smallest coherent issue slice.
3. Run focused checks, required behavior proof, `pnpm check`, and the complete
   `pnpm check:full` handoff gate.
4. Commit with a conventional commit message, push `main`, comment with the
   implementation and verification evidence, and close the issue.
5. Compact the working context before selecting the next issue when compaction
   is available.

Stop loop mode instead of guessing when:

- the next issue is ambiguous, stale, not self-contained, or requires an
  unresolved product decision;
- a dependency is missing, incomplete, excluded, or only implemented outside
  the aligned `main` branch;
- unrelated work appears or `main` diverges from `origin/main`;
- required validation or behavior proof cannot pass without widening scope;
- required credentials, provider access, or manual external proof are missing;
- a commit, push, GitHub comment, or issue closure fails; or
- the authorized issue scope is exhausted.

Report the exact blocker and leave later issues untouched. Never expand the
authorized issue scope, refine the backlog, or create replacement work while
loop mode is active unless the objective explicitly authorizes it.

## Workflow

1. Identify the repository.
   - Prefer `gh repo view --json nameWithOwner,url`.
   - Otherwise use `git remote get-url origin` and convert it to `owner/repo`.
   - If the current directory is not this repository, stop and ask for the
     target checkout.
2. Inspect local state before planning.
   - Run `git status --short`, `git branch --show-current`, and inspect the
     upstream/main state.
   - This repo ships directly from `main`. If not on `main`, switch to `main`
     only when the worktree is clean or the dirty changes are clearly yours and
     safe to carry. If user or unrelated changes would be disturbed, report the
     blocking state and wait.
   - Pull or otherwise verify current `origin/main` before editing when network
     and credentials allow it.
3. Read planning and operating context.
   - Always read `AGENTS.md`.
   - Read `docs/internal/MANIFEST.md`, `docs/internal/ROADMAP.md`, and any
     relevant docs they reference.
   - Read relevant ADRs in `docs/internal/adr/` or
     `docs/internal/decisions/` when present.
   - Read `docs/internal/REPOSITORY_MODEL.md` when repository setup, sandbox
     behavior, writeback, watched repositories, or provenance are involved.
   - Read `docs/internal/USER_TESTING.md` and existing files under `evals/`
     when the task changes agent behavior or test coverage.
   - Before writing Eve runtime code, tools, channels, skills, sandbox config,
     evals, or instructions, read the relevant installed Eve docs under
     `node_modules/eve/docs/`.
   - Keep `agent/instructions.md` short and stable. Put scenario choreography,
     tool-order expectations, and regression assertions in `evals/`, test
     fixtures, or manual scenarios instead.
4. Inspect the ordered GitHub issue backlog.
   - Use GitHub tools when available; otherwise use `gh`.
   - Prefer the agreed ordered backlog view, project view, priority field, or
     milestone order when one exists.
   - If no richer GitHub ordering is available, use the ordered issue table in
     `docs/internal/ROADMAP.md`.
   - Fetch enough details for the top issues: title, body, labels, milestone,
     comments, links, and current state.
   - Do not treat GitHub's default issue list as product order unless the repo
     explicitly adopted that ordering.
5. Reconcile earlier ordered issues before selecting new work.
   - Walk open issues from the top of the active backlog.
   - If an earlier issue is already satisfied on `main`, verify its acceptance
     criteria against source, docs, tests, evals, and recent commits.
   - When completion is evidence-backed on `main`, add a short issue comment
     with implementation and verification evidence, then close the issue if it
     is still open.
   - If completion is only local, on another branch, or otherwise unmerged to
     `main`, treat it as not complete for this workflow. Do not skip dependent
     work unless the user explicitly confirms the dependency is safe to bypass.
   - If completion is ambiguous, report a backlog problem instead of guessing.
6. Assess whether the next open issue is still coherent.
   - Check that dependencies appear before dependent work.
   - Check for duplicate, stale, conditional, vague, or placeholder issues.
   - Check that the issue still matches `docs/internal/MANIFEST.md`,
     `docs/internal/ROADMAP.md`, repo docs, current code, and latest user
     feedback.
   - Treat material disagreements as backlog problems and suggest `$refine`
     rather than selecting premature implementation work.
7. Select exactly one issue when the backlog is coherent.
   - Prefer the smallest vertical slice that proves behavior.
   - Do not widen scope because adjacent cleanup looks convenient.
   - Ignore later-phase issues until the active milestone is complete unless
     the user explicitly redirects.
8. Propose the design before editing.
   - Explain the selected issue, why it matters, what changes, repo-specific
     gates, proposed implementation shape, tradeoffs, acceptance criteria, and
     any unresolved scope question.
   - Ask at most one scope question at a time. Include a recommended answer.
   - Try to answer questions from the repo, issues, docs, and code before
     asking the user.
   - Outside loop mode, wait for explicit user approval before implementation.
   - In loop mode, treat the bounded objective as advance approval and continue
     without pausing.
9. Implement only the accepted slice.
   - Preserve unrelated user or local changes.
   - Follow existing repo patterns and Eve conventions.
   - Add tests or eval coverage proportional to risk.
   - Update docs only when the task changes the product contract, public
     workflow, development loop, or user-test surface.
10. When the slice changes agent behavior, prove it for an end user.
    - Prefer an executable Eve eval when the behavior can be asserted through
      stable tool calls, outputs, or final response checks.
    - If an executable eval would be too brittle, too slow, blocked by missing
      product support, or outside the accepted slice, add or update a manual
      scenario under `evals/scenarios/manual/` or present a copy-paste scenario
      in the final response.
    - The scenario must be written as an end-user prompt, not as an internal
      implementation checklist.
    - State what the user should expect to see and which command or manual
      flow runs it.
11. Verify before handoff.
    - Run the narrowest meaningful checks during development.
    - Always run `pnpm check` before finalizing, per `AGENTS.md`.
    - If an eval was added or changed, run the targeted eval when practical.
      If not practical, say exactly why and provide the manual scenario.
12. Ship directly on `main`.
    - Do not open a PR.
    - Do not create or update a draft PR.
    - Outside loop mode, after checks pass, propose a conventional commit message
      and end with `Commit? [Y/n]`, as required by `AGENTS.md`.
    - Outside loop mode, on approval, commit on `main`, push `origin main`,
      comment on the GitHub issue with the commit, checks, eval or scenario
      evidence, and close the issue.
    - In loop mode, use the advance approval to commit, push, comment, and close
      without prompting, then continue to the next authorized issue.
    - If pushing or issue updates fail, report the failure visibly with the
      exact command or API error. Do not pretend the issue was shipped.
13. Summarize what changed, what was verified, what eval or scenario covers the
    behavior, and what remains.

## Backlog Problem Format

If the backlog has ordering, dependency, duplication, stale-state, or
product-shape problems, do not propose a next task. Respond with:

```markdown
**Backlog Assessment**
List the concrete issue-order, dependency, duplication, stale-state, or product
problems. Explain why they would make `$next` select the wrong work.

**Recommended Cleanup**
Name the smallest issue or docs cleanup that would restore a coherent next
slice. Suggest `$refine` when issue creation or editing is the right move.

**Waiting For Direction**
Ask for explicit approval or direction only when the cleanup was not already
approved.
```

## Design Proposal Format

When the backlog is coherent, respond before implementation with:

```markdown
**Next Task**
Name the GitHub issue and the slice you propose.

**Why This Matters**
Explain the product or engineering reason briefly.

**Proposed Design**
Describe the modules, data flow, boundaries, and Eve docs consulted or still
needed. Keep it simple enough that a non-author can repeat it back.

**Repo-Specific Gates**
Summarize relevant `AGENTS.md`, manifest, roadmap, repository-model,
user-testing, and Eve-doc constraints.

**Behavior Proof**
State whether this slice changes agent behavior. If yes, propose the eval or
manual end-user scenario that will prove it.

**Tradeoffs**
Call out important choices, risks, and what is intentionally deferred.

**Acceptance Criteria**
List the concrete behavior that counts as done.

**Scope Question**
Ask exactly one unresolved high-value question, with a recommended answer. If
there are no meaningful unknowns, say so.

**Waiting For Approval**
Ask the user to approve or adjust the proposal before implementation.
```

## Useful Commands

```bash
gh repo view --json nameWithOwner,url
gh issue list --repo OWNER/REPO --state open --limit 20 --json number,title,url,body,labels,milestone,createdAt,updatedAt
gh issue view NUMBER --repo OWNER/REPO --comments --json number,title,state,url,body,comments,labels,milestone,createdAt,updatedAt
gh issue comment NUMBER --repo OWNER/REPO --body-file /tmp/issue-comment.md
gh issue close NUMBER --repo OWNER/REPO --comment "Implemented on main in COMMIT. Verified with ..."
git switch main
git pull --ff-only origin main
pnpm check
pnpm eval --list
pnpm eval EVAL_NAME --skip-report --verbose
git commit -m "type(scope): summary"
git push origin main
```

Do not use `gh pr create`, `gh pr edit`, or draft-PR closing keywords in this
repo-specific `$next` workflow.
