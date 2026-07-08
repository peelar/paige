import {
  WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH,
  WORKING_DOCUMENTATION_REPOSITORY_PROVENANCE_LABEL,
  type WorkingDocumentationRepository,
} from "../../agent/lib/repository-contract.js";

import type { UserTestScenario } from "./schema.js";

const saleorDocsWorkingRepository: WorkingDocumentationRepository = {
  source: {
    type: "github-url",
    url: "https://github.com/peelar/saleor-docs.git",
  },
  ref: "main",
  docsRoot: "docs",
  sandboxPath: WORKING_DOCUMENTATION_REPOSITORY_SANDBOX_PATH,
  accessMode: "sandbox-write",
  allowedActions: ["clone", "read", "search", "patch", "run-checks", "export-diff"],
  provenanceLabel: WORKING_DOCUMENTATION_REPOSITORY_PROVENANCE_LABEL,
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
          assignee: "Docs maintainer",
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
      impactReportMustInclude: [
        "The working repository was cloned or materialized at /workspace/working-docs.",
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
      mustNotDo: [
        "Do not create a new page.",
        "Do not modify generated API reference files.",
        "Do not mention Saleor source-code evidence because this scenario does not provide a source repository.",
        "Do not push or open a draft PR without explicit approval.",
      ],
      checks: [
        {
          command: "corepack enable && pnpm install --frozen-lockfile",
          required: true,
          rationale:
            "Install the working repository's locked dependencies inside the sandbox before running Docusaurus checks.",
        },
        {
          command: "pnpm build",
          required: true,
          rationale:
            "Verify the edited Saleor docs site still builds after the Markdown/MDX patch.",
        },
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
          assignee: "Docs maintainer",
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
      impactReportMustInclude: [
        "The working repository was cloned or materialized at /workspace/working-docs.",
        "docs/api-usage/usage-limits.mdx was inspected.",
        "The attached issue and discussion say 180 rpm was internal-only.",
        "The current public docs already state 120 requests/minute.",
        "No patch was produced.",
      ],
      expectedTouchedFiles: [],
      forbiddenTouchedFiles: ["docs/api-usage/usage-limits.mdx", "docs/api-reference/**"],
      expectedPatchHints: [],
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
] satisfies readonly UserTestScenario[];
