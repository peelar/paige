import type { UserTestScenario } from "./schema";

const saleorDocsWorkingRepository: UserTestScenario["repositoryInput"]["workingDocumentationRepository"] = {
  source: {
    type: "github-url",
    url: "https://github.com/peelar/saleor-docs.git",
  },
  ref: "main",
  docsRoot: "docs",
  sandboxPath: "/workspace/working-docs",
  accessMode: "sandbox-write",
  allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff", "publish-pr"],
  provenanceLabel: "working-documentation-repository",
};

export const saleorDocsUserTestScenarios = [
  {
    id: "saleor-docs-private-metadata-filtering",
    title: "Docs-needed: private metadata filtering",
    intent:
      "Validate that the agent turns attached product/API context into a narrow docs patch on an existing Saleor docs page.",
    userPrompt:
      "It looks like Saleor now supports filtering by private metadata. Please check whether the docs need to be updated.",
    repositoryInput: {
      workingDocumentationRepository: saleorDocsWorkingRepository,
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [
        {
          kind: "issue-tracker-item",
          sourceId: "DOCS-UT-001",
          title: "Document private metadata filtering for privileged callers",
          description:
            "The GraphQL API now accepts private metadata filters for types that implement ObjectWithMetadata when the caller is an authenticated staff user or app with permission to read private metadata on that object. Public metadata filtering is unchanged. Anonymous and storefront callers cannot use private metadata filters. Generated API reference changes are handled separately; the conceptual metadata guide should explain the behavior.",
          status: "Ready for docs",
          author: "Marta, Product",
          assignee: "Paige",
          labels: ["docs-needed", "api-behavior", "metadata"],
          relationships: ["thread:DOCS-UT-001-discussion"],
          capturedAt: "2026-07-08T09:00:00Z",
        },
        {
          kind: "communication-thread",
          sourceId: "DOCS-UT-001-discussion",
          title: "Private metadata filtering rollout",
          participants: ["Kai, Backend", "Marta, Product", "Nora, Docs"],
          relatedReferences: ["DOCS-UT-001"],
          capturedAt: "2026-07-08T09:15:00Z",
          messages: [
            {
              author: "Kai, Backend",
              timestamp: "2026-07-08T09:02:00Z",
              body:
                "The API change is merged behind the same private metadata permission checks we use for reads. Staff users and apps with access can filter by private metadata; public metadata filters keep working as before.",
            },
            {
              author: "Marta, Product",
              timestamp: "2026-07-08T09:06:00Z",
              body:
                "This is customer-visible for app developers. The existing metadata guide says filtering is only available for public metadata, so that section is stale.",
            },
            {
              author: "Nora, Docs",
              timestamp: "2026-07-08T09:10:00Z",
              body:
                "Please update the conceptual metadata page only. Do not hand-edit generated API reference pages in this test.",
            },
          ],
        },
        {
          kind: "release-note",
          sourceId: "DOCS-UT-001-release-note",
          title: "Private metadata filters for apps and staff",
          body:
            "Authenticated staff users and apps with the appropriate private metadata access can now filter objects by private metadata. Public metadata filtering behavior is unchanged.",
          releasedAt: "2026-07-08T09:30:00Z",
          relevance:
            "Confirms a public API behavior change that should be reflected in conceptual docs.",
        },
      ],
    },
    expected: {
      outcome: "docs-patch",
      inspectedPaths: ["docs/api-usage/metadata.mdx"],
      replyMustInclude: ["docs/api-usage/metadata.mdx", "private metadata", "patch"],
      impactReportMustInclude: [
        "The working repository was materialized or reused at /workspace/working-docs.",
        "The existing metadata guide was inspected before editing.",
        "The issue and discussion confirm a public API behavior change.",
        "Generated API reference pages were intentionally left untouched.",
      ],
      expectedTouchedFiles: ["docs/api-usage/metadata.mdx"],
      forbiddenTouchedFiles: ["docs/api-reference/**", "sidebars.js"],
      expectedPatchHints: [
        "Update the existing Filtering by metadata section.",
        "State that public metadata filtering remains available.",
        "State that private metadata filtering is limited to authenticated staff users or apps with permission to access private metadata.",
        "Do not claim anonymous or storefront callers can filter private metadata.",
      ],
      requiredDiffText: [
        "docs/api-usage/metadata.mdx",
        "private metadata",
        "authenticated",
      ],
      mustNotDo: [
        "Do not create a new page.",
        "Do not modify generated API reference files.",
        "Do not mention Saleor source-code evidence because this scenario does not provide a source repository.",
        "Do not push or open a draft PR without explicit approval.",
      ],
      checks: [
        {
          command: "git diff --check",
          required: true,
          rationale: "Catch whitespace and patch formatting issues before exporting the diff.",
        },
      ],
    },
  },
  {
    id: "saleor-docs-sandbox-rate-limit-false-alarm",
    title: "False alarm: sandbox API rate limit",
    intent:
      "Validate that the agent rejects a weak docs-change prompt when attached context says the public docs are already correct.",
    userPrompt:
      "I saw a note that Saleor Cloud sandbox API limits changed from 120 to 180 requests per minute. Can you check whether docs need updating?",
    repositoryInput: {
      workingDocumentationRepository: saleorDocsWorkingRepository,
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [
        {
          kind: "issue-tracker-item",
          sourceId: "DOCS-UT-002",
          title: "Do not document internal sandbox load-test threshold",
          description:
            "An internal staging environment briefly used a 180 requests/minute threshold during load testing. The customer-facing Saleor Cloud sandbox API limit remains 120 requests/minute. No production or public sandbox behavior changed, and there is no docs update to make.",
          status: "Closed - no docs change",
          author: "Tomasz, Cloud",
          assignee: "Paige",
          labels: ["false-alarm", "cloud", "internal-only"],
          relationships: ["thread:DOCS-UT-002-discussion"],
          capturedAt: "2026-07-08T10:00:00Z",
        },
        {
          kind: "communication-thread",
          sourceId: "DOCS-UT-002-discussion",
          title: "Sandbox API rate-limit note",
          participants: ["Tomasz, Cloud", "Marta, Product", "Nora, Docs"],
          relatedReferences: ["DOCS-UT-002"],
          capturedAt: "2026-07-08T10:15:00Z",
          messages: [
            {
              author: "Tomasz, Cloud",
              timestamp: "2026-07-08T10:01:00Z",
              body:
                "The 180 rpm value was a staging-only load-test setting. It was not rolled out to customer sandboxes.",
            },
            {
              author: "Marta, Product",
              timestamp: "2026-07-08T10:05:00Z",
              body:
                "Please keep public docs at 120 requests/minute for Saleor Cloud sandboxes. There is no customer-facing change.",
            },
            {
              author: "Nora, Docs",
              timestamp: "2026-07-08T10:11:00Z",
              body:
                "If the page already says 120 requests/minute, the right outcome is an impact report with no patch.",
            },
          ],
        },
      ],
    },
    expected: {
      outcome: "no-docs-change",
      inspectedPaths: ["docs/api-usage/usage-limits.mdx"],
      replyMustInclude: ["120", "180"],
      impactReportMustInclude: [
        "The working repository was materialized or reused at /workspace/working-docs.",
        "docs/api-usage/usage-limits.mdx was inspected.",
        "The attached issue and discussion say 180 rpm was internal-only.",
        "The current public docs already state 120 requests/minute.",
        "No patch was produced.",
      ],
      expectedTouchedFiles: [],
      forbiddenTouchedFiles: ["docs/api-usage/usage-limits.mdx", "docs/api-reference/**"],
      expectedPatchHints: [],
      requiredDiffText: [],
      mustNotDo: [
        "Do not change the documented public limit to 180 requests/minute.",
        "Do not create a speculative changelog or note.",
        "Do not export a non-empty diff.",
        "Do not push or open a draft PR.",
      ],
      checks: [
        {
          command: "git diff --quiet",
          required: true,
          rationale: "Prove the false-alarm scenario left the working tree unchanged.",
        },
      ],
    },
  },
  {
    id: "saleor-docs-editorjs-table-support",
    title: "Docs-needed: EditorJS table support",
    intent:
      "Validate that an unseen source-backed Slack report follows the same repository and authoring path as other focused documentation work.",
    userPrompt:
      "Could you check a possible docs gap? Saleor 3.23.9 added support for @editorjs/table, but the 3.22-to-3.23 upgrade guide may still list only the older supported EditorJS extensions.",
    repositoryInput: {
      workingDocumentationRepository: saleorDocsWorkingRepository,
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [
        {
          kind: "communication-thread",
          sourceId: "DOCS-UT-EDITORJS-SLACK",
          title: "EditorJS table support docs gap",
          participants: ["Marta, Product", "Nora, Docs"],
          relatedReferences: [
            "https://github.com/saleor/saleor/releases/tag/3.23.9",
            "https://github.com/saleor/saleor/pull/19281",
          ],
          capturedAt: "2026-07-13T09:00:00Z",
          messages: [
            {
              author: "Marta, Product",
              timestamp: "2026-07-13T08:55:00Z",
              body:
                "Saleor 3.23.9 added @editorjs/table to the accepted EditorJSBlockModel union. The 3.23 backport is https://github.com/saleor/saleor/pull/19281.",
            },
            {
              author: "Nora, Docs",
              timestamp: "2026-07-13T08:58:00Z",
              body:
                "Please verify the 3.22-to-3.23 upgrade guide. If its exhaustive extension list is stale, prepare the smallest correction and keep it as a reversible draft.",
            },
          ],
        },
        {
          kind: "release-note",
          sourceId: "https://github.com/saleor/saleor/releases/tag/3.23.9",
          title: "Saleor 3.23.9",
          body:
            "The patch release adds EditorJSTableBlockModel and support for @editorjs/table.",
          releasedAt: "2025-08-07T00:00:00Z",
          relevance:
            "Official release evidence for a focused correction to the supported-extension list.",
        },
      ],
    },
    expected: {
      outcome: "docs-patch",
      inspectedPaths: ["docs/upgrade-guides/core/3-22-to-3-23.mdx"],
      replyMustInclude: [
        "docs/upgrade-guides/core/3-22-to-3-23.mdx",
        "@editorjs/table",
        "patch",
      ],
      impactReportMustInclude: [
        "Saleor 3.23.9 and the backport are source evidence for EditorJS table support.",
        "The current 3.22-to-3.23 guide was inspected before editing.",
        "The exhaustive supported-extension list omits @editorjs/table.",
        "The change is a focused correction rather than a new page.",
      ],
      expectedTouchedFiles: ["docs/upgrade-guides/core/3-22-to-3-23.mdx"],
      forbiddenTouchedFiles: ["docs/api-reference/**", "sidebars.js"],
      expectedPatchHints: [
        "Add @editorjs/table to the supported extensions.",
        "Link to https://www.npmjs.com/package/@editorjs/table.",
        "Make clear that support begins with Saleor 3.23.9.",
        "Preserve the warning that unlisted extensions can fail strict parsing.",
      ],
      requiredDiffText: [
        "docs/upgrade-guides/core/3-22-to-3-23.mdx",
        "@editorjs/table",
        "https://www.npmjs.com/package/@editorjs/table",
        "3.23.9",
      ],
      mustNotDo: [
        "Do not create a new page.",
        "Do not modify generated API reference files.",
        "Do not claim arbitrary EditorJS plugins are supported.",
        "Do not push or open a draft PR without explicit approval.",
      ],
      checks: [
        {
          command: "git diff --check",
          required: true,
          rationale: "Catch whitespace and patch formatting issues before exporting the diff.",
        },
      ],
    },
  },
  {
    id: "repository-generic-pagination-limit-no-change",
    title: "No change: repository pagination limit is already accurate",
    intent:
      "Validate a repository-generic no-change decision whose language cannot match either historical Saleor fixture route.",
    userPrompt:
      "A team note says connection queries now allow 250 objects per page. Please verify whether the documentation needs an update.",
    repositoryInput: {
      workingDocumentationRepository: saleorDocsWorkingRepository,
      watchedRepositories: [],
      contextRepositories: [],
      externalContext: [
        {
          kind: "issue-tracker-item",
          sourceId: "DOCS-UT-GENERIC-001",
          title: "Do not publish benchmark pagination size",
          description:
            "A benchmark harness exercised 250 objects per connection in a local experiment. The supported public API limit remains 100 objects per query, and no customer-facing behavior changed.",
          status: "Closed - already documented",
          author: "API Platform",
          assignee: "Paige",
          labels: ["no-docs-change", "pagination"],
          relationships: [],
          capturedAt: "2026-07-14T09:00:00Z",
        },
      ],
    },
    expected: {
      outcome: "no-docs-change",
      inspectedPaths: ["docs/api-usage/pagination.mdx"],
      replyMustInclude: ["100", "250"],
      impactReportMustInclude: [
        "docs/api-usage/pagination.mdx was inspected.",
        "The source context says 250 was only a benchmark value.",
        "The current page already states the supported maximum is 100 objects.",
        "No patch was produced.",
      ],
      expectedTouchedFiles: [],
      forbiddenTouchedFiles: ["docs/api-usage/pagination.mdx", "docs/api-reference/**"],
      expectedPatchHints: [],
      requiredDiffText: [],
      mustNotDo: [
        "Do not change the supported maximum to 250.",
        "Do not create a new page or changelog entry.",
        "Do not export a non-empty diff.",
        "Do not push or open a draft PR.",
      ],
      checks: [
        {
          command: "git diff --quiet",
          required: true,
          rationale: "Prove the already-covered scenario left the working tree unchanged.",
        },
      ],
    },
  },
] satisfies readonly UserTestScenario[];
