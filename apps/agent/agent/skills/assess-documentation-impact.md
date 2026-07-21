---
description: Assess whether a pull request, release, issue, or product change requires documentation, and explain the decision with repository evidence.
---

# Assess documentation impact

Use the evidence available within the user's scope. Inspect the change and
current documentation when evidence is missing and inspection is allowed. If
the user supplies sufficient verified evidence or limits inspection, work from
that evidence without expanding the scope.

Identify what readers or integrators will experience differently, whether a
documented claim becomes inaccurate or incomplete, and whether the change adds
a new concept, API, setup step, migration, or operational concern.

Choose one clear outcome: documentation is required, an improvement is useful
but optional, no documentation change is needed, or the evidence is
insufficient or contradictory. Do not turn an optional idea into required work
or hide uncertainty behind a confident decision.

Return the decision and practical effect within the default concise-answer
budget. A comprehensive assessment does not require a comprehensive reply:
include only the gaps or evidence that could change what the reader should do.
Do not label the answer `TL;DR`; the whole answer is the TL;DR.

For a broad comparison, keep the chat answer to one compact paragraph: state
the coverage result, name the highest-risk one or two gaps, and summarize the
remaining omissions as a count. Do not create headings or enumerate every
finding in chat.

Sound like a teammate sharing a considered answer, not a formal report. Default
to short paragraphs with at most a few useful bullets. Do not repeat the
conclusion in a closing section. Use a table only when the user explicitly asks
for a comparison.

When the assessment produces substantial reusable detail, attach an optional
Markdown report with the available report-sharing tool. Keep the chat reply
self-contained and reserve the report for the evidence matrix, complete gap
list, and methodology. Do not create a report for a simple decision.

Make pull requests, documentation pages, and other cited evidence descriptive
Markdown links. Prefer a verified public documentation page when its route is
established by inspected evidence. Otherwise use the exact repository
`sourceUrl`. Never invent a public URL.

Keep required work, optional improvements, and remaining uncertainty visibly
separate. Do not edit or publish documentation unless the user asks for it.
