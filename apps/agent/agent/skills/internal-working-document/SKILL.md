---
description: Use when a Paige-owned internal working document should be created, read, or revised across Eve sessions. This covers living summaries, chronological work logs, and other bounded documentation-work notes; it does not cover workspace memory or public documentation drafts.
---

# Internal working documents

Use `internal_document` for explicit Paige-owned working state that must survive
the current Eve session. Do not create a document for transient reasoning or a
quick answer.

Before updating, read the current document and then call `internal_document` in
`update` mode with that same document id and its current revision. Do not create
a replacement or duplicate document when the working purpose already has one.
Keep source references bounded and attributable. Store conclusions, evidence,
hypotheses, decisions, and open questions only when they are useful to later
documentation work. Do not store hidden reasoning, secrets, or raw provider
content merely to extend its retention.

Follow the document's editing profile:

- `living-summary`: revise superseded statements in place and keep one concise,
  current account of the work.
- `chronological-log`: retain earlier entries and append a short dated entry for
  a meaningful new event. Do not append a no-op turn.

These profiles change editing procedure only. They use the same
`internal_document` operations and `docs_work.manage` authority.

Archive a document when its working purpose is complete. Internal documents are
not public documentation, repository drafts, workspace memories, or proof for a
public claim.
