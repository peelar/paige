It looks like Saleor now supports filtering by private metadata. Please check whether the docs need to be updated.
Work only from the working documentation repository and attached context below.
Produce a documentation impact report first. Prepare a patch only if the evidence supports it.

## Working Documentation Repository

URL: https://github.com/peelar/saleor-docs.git
Allowed actions: clone, read, search, patch, run-checks, export-diff, publish-pr

## Attached Context

### Issue: Document private metadata filtering for privileged callers

Source: DOCS-UT-001
Status: Ready for docs
Labels: docs-needed, api-behavior, metadata

The GraphQL API now accepts private metadata filters for types that implement ObjectWithMetadata when the caller is an authenticated staff user or app with permission to read private metadata on that object. Public metadata filtering is unchanged. Anonymous and storefront callers cannot use private metadata filters. Generated API reference changes are handled separately; the conceptual metadata guide should explain the behavior.

### Communication Thread: Private metadata filtering rollout

Source: DOCS-UT-001-discussion
Participants: Kai, Backend, Marta, Product, Nora, Docs

- 2026-07-08T09:02:00Z Kai, Backend: The API change is merged behind the same private metadata permission checks we use for reads. Staff users and apps with access can filter by private metadata; public metadata filters keep working as before.
- 2026-07-08T09:06:00Z Marta, Product: This is customer-visible for app developers. The existing metadata guide says filtering is only available for public metadata, so that section is stale.
- 2026-07-08T09:10:00Z Nora, Docs: Please update the conceptual metadata page only. Do not hand-edit generated API reference pages in this test.

### Release Note: Private metadata filters for apps and staff

Source: DOCS-UT-001-release-note
Released At: 2026-07-08T09:30:00Z

Authenticated staff users and apps with the appropriate private metadata access can now filter objects by private metadata. Public metadata filtering behavior is unchanged.
Relevance: Confirms a public API behavior change that should be reflected in conceptual docs.
