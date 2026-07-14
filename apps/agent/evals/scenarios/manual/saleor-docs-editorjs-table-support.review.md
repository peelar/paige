# Docs-needed: EditorJS table support

This complementary Slack scenario checks whether Paige can turn a real Saleor
patch-release change into a focused correction of an existing guide through
provider intake and thread continuation. The same source provenance and patch
contract are also covered by the executable Eve user-test scenario.

Baseline checked on 2026-07-13: `peelar/saleor-docs` main at
`ab5a9eb6872151145503f6ccb2b57d1cdef5c8fc`.

Expected outcome: `docs-patch`.

## Impact report must include

- Saleor 3.23.9 and the 3.23 backport are release and source evidence that
  EditorJS table blocks are supported.
- The current 3.22-to-3.23 upgrade guide was inspected before editing.
- The guide's exhaustive supported-extension list omits `@editorjs/table`, so
  its follow-up statement that every other extension is unsupported is stale.
- The change is a focused correction, not a new document or API-reference
  regeneration.

## Expected first message

- Load the docs-signal-intake skill and call `capture_slack_docs_signal`.
- Capture the official release and backport links as available source evidence.
- Create or deduplicate one Slack-thread docs signal and decide that current
  docs verification is needed.
- If workspace setup is ready, inspect the configured working documentation
  repository and the likely upgrade-guide page.
- Report the stale exhaustive list, but do not patch or publish during intake.

## Expected second message

- Continue in the same Slack thread and Eve session, reusing the existing docs
  signal.
- Load the docs-maintenance skill and docs profile before writing.
- Record a `focused-patch` editorial recommendation.
- Skip the `docs_work_manage` plan operation because this is a localized
  existing-page edit.
- Apply and prepare the reversible draft, including a visible diff and checks.

## Expected touched files

- `docs/upgrade-guides/core/3-22-to-3-23.mdx`

## Patch contract

- Add `@editorjs/table` to the supported EditorJS extensions.
- Use the package URL `https://www.npmjs.com/package/@editorjs/table`.
- Preserve the warning that unlisted extensions can fail strict parsing.
- Keep the wording accurate for Saleor 3.23.9 rather than implying table blocks
  were present in every 3.23 patch.

## Must not do

- Do not create a new page.
- Do not modify generated files under `docs/api-reference/`.
- Do not claim arbitrary EditorJS plugins are supported.
- Do not turn the focused correction into a general EditorJS tutorial.
- Do not push or open a draft PR without explicit approval.

If the optional third Slack message is used, publication should target only
`peelar/saleor-docs` and create or reuse a draft PR through the approved
writeback path.

## Checks

- Required: `git diff --check`.
- The final report should name the changed file, evidence used, check result,
  and any remaining uncertainty.
