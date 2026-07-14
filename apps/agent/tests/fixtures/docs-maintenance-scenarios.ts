import type { ToolContext } from "eve/tools";

import type {
  ExternalContext,
  ResolvedRepositoryInput,
} from "../../agent/lib/repository-contract";
import type { RepositoryActionRecord } from "../../agent/lib/repository-materialization";
import {
  readRepositoryFile,
  replaceRepositoryText,
  runRepositoryCheck,
  searchRepository,
} from "../../agent/lib/repository-operations";
import type { DocumentationImpactReport } from "../../agent/lib/repository-workflow-contract";

export type FixtureScenarioKind =
  | "private-metadata-filtering"
  | "sandbox-rate-limit-false-alarm"
  | "unknown";

export function detectFixtureScenarioKind(
  scenarioText: string,
  externalContext: ExternalContext[],
): FixtureScenarioKind {
  const haystack = [scenarioText, ...externalContext.map((context) => JSON.stringify(context))]
    .join("\n")
    .toLowerCase();

  if (haystack.includes("private metadata") && haystack.includes("filter")) {
    return "private-metadata-filtering";
  }

  if (
    haystack.includes("120 requests/minute") &&
    haystack.includes("180") &&
    haystack.includes("internal")
  ) {
    return "sandbox-rate-limit-false-alarm";
  }

  return "unknown";
}

export async function runScenarioFixture(
  ctx: ToolContext,
  scenarioKind: FixtureScenarioKind,
  repositoryInput: ResolvedRepositoryInput,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocumentationImpactReport> {
  if (scenarioKind === "private-metadata-filtering") {
    return runPrivateMetadataFilteringScenario(ctx, repositoryInput, actionProvenance);
  }
  if (scenarioKind === "sandbox-rate-limit-false-alarm") {
    return runSandboxRateLimitFalseAlarmScenario(ctx, repositoryInput, actionProvenance);
  }

  const repository = repositoryInput.workingDocumentationRepository;
  const checks = [await runRepositoryCheck(ctx, repository, "status", actionProvenance)];
  return {
    decision: "ask-maintainer",
    affectedPages: [],
    proposedAction: "Ask a maintainer for a clearer docs-impact target before preparing a patch.",
    evidence: ["The scenario did not match a supported deterministic fixture."],
    consideredPages: [],
    uncertainty: ["Only the two historical Saleor user-test fixtures are implemented here."],
    patchSummary: "No patch prepared.",
    checks,
  };
}

async function runPrivateMetadataFilteringScenario(
  ctx: ToolContext,
  repositoryInput: ResolvedRepositoryInput,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocumentationImpactReport> {
  const repository = repositoryInput.workingDocumentationRepository;
  const targetPath = "docs/api-usage/metadata.mdx";
  const consideredPages = [targetPath, "docs/api-reference/**"];

  await searchRepository(ctx, repository, "Filtering by metadata", actionProvenance);
  const existing = await readRepositoryFile(ctx, repository, targetPath, actionProvenance);

  const expectedText =
    "Objects with metadata interface can be filtered by their values. Filtering is only available for public metadata.";
  const replacementText =
    "Objects that implement the metadata interface can be filtered by their values. Public metadata filtering remains available. Private metadata filtering is available only to authenticated staff users and Apps with permission to access private metadata for that object.";

  if (existing.includes(expectedText)) {
    await replaceRepositoryText(
      ctx,
      repository,
      targetPath,
      expectedText,
      replacementText,
      actionProvenance,
    );
  } else if (!existing.includes(replacementText)) {
    throw new Error(`Could not find the expected metadata filtering text in ${targetPath}.`);
  }

  const checks = [await runRepositoryCheck(ctx, repository, "diff-check", actionProvenance)];

  return {
    decision: "docs-patch",
    affectedPages: [targetPath],
    proposedAction:
      "Update the existing metadata guide to document permission-bound private metadata filtering.",
    evidence: [
      "DOCS-UT-001 says private metadata filters are now accepted for authenticated staff users and apps with private metadata access.",
      "DOCS-UT-001-discussion says the existing metadata guide is stale because it says filtering is only available for public metadata.",
      "DOCS-UT-001-release-note confirms public metadata filtering is unchanged.",
    ],
    consideredPages,
    uncertainty: [
      "No Saleor source repository was provided; this decision relies on the attached structured context.",
      "Generated API reference pages were intentionally left untouched.",
    ],
    patchSummary: `Updated ${targetPath} in the existing Filtering by metadata section.`,
    checks,
  };
}

async function runSandboxRateLimitFalseAlarmScenario(
  ctx: ToolContext,
  repositoryInput: ResolvedRepositoryInput,
  actionProvenance: RepositoryActionRecord[],
): Promise<DocumentationImpactReport> {
  const repository = repositoryInput.workingDocumentationRepository;
  const targetPath = "docs/api-usage/usage-limits.mdx";

  await searchRepository(ctx, repository, "120 requests/minute", actionProvenance);
  const existing = await readRepositoryFile(ctx, repository, targetPath, actionProvenance);

  const evidence = [
    "DOCS-UT-002 says the 180 requests/minute threshold was internal-only.",
    "DOCS-UT-002-discussion says public Saleor Cloud sandbox limits remain 120 requests/minute.",
  ];

  if (!existing.includes("120 requests/minute")) {
    return {
      decision: "ask-maintainer",
      affectedPages: [targetPath],
      proposedAction:
        "Ask a maintainer to confirm the public sandbox rate limit because the expected 120 requests/minute text was not found.",
      evidence,
      consideredPages: [targetPath],
      uncertainty: ["The current docs did not contain the expected public limit text."],
      patchSummary: "No patch prepared.",
      checks: [await runRepositoryCheck(ctx, repository, "status", actionProvenance)],
    };
  }

  const checks = [await runRepositoryCheck(ctx, repository, "diff-quiet", actionProvenance)];

  return {
    decision: "no-docs-change",
    affectedPages: [],
    proposedAction:
      "Do not change the docs. The current public docs already state the correct sandbox rate limit.",
    evidence: [
      ...evidence,
      `${targetPath} already states Saleor Cloud sandboxes are limited to 120 requests/minute.`,
    ],
    consideredPages: [targetPath],
    uncertainty: [
      "The scenario provides no customer-facing change; the 180 requests/minute note is internal-only.",
    ],
    patchSummary: "No patch prepared because the prompt was a false alarm.",
    checks,
  };
}
