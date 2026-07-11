I saw a note that Saleor Cloud sandbox API limits changed from 120 to 180 requests per minute. Can you check whether docs need updating?
Work only from the working documentation repository and attached context below.
Produce a documentation impact report first. Prepare a patch only if the evidence supports it.

## Working Documentation Repository

URL: https://github.com/peelar/saleor-docs.git
Allowed actions: clone, read, search, patch, run-checks, export-diff, publish-pr

## Attached Context

### Issue: Do not document internal sandbox load-test threshold

Source: DOCS-UT-002
Status: Closed - no docs change
Labels: false-alarm, cloud, internal-only

An internal staging environment briefly used a 180 requests/minute threshold during load testing. The customer-facing Saleor Cloud sandbox API limit remains 120 requests/minute. No production or public sandbox behavior changed, and there is no docs update to make.

### Communication Thread: Sandbox API rate-limit note

Source: DOCS-UT-002-discussion
Participants: Tomasz, Cloud, Marta, Product, Nora, Docs

- 2026-07-08T10:01:00Z Tomasz, Cloud: The 180 rpm value was a staging-only load-test setting. It was not rolled out to customer sandboxes.
- 2026-07-08T10:05:00Z Marta, Product: Please keep public docs at 120 requests/minute for Saleor Cloud sandboxes. There is no customer-facing change.
- 2026-07-08T10:11:00Z Nora, Docs: If the page already says 120 requests/minute, the right outcome is an impact report with no patch.
