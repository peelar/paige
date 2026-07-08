import type { UserTestScenario } from "./schema.js";

type ExternalContext = UserTestScenario["repositoryInput"]["externalContext"][number];

function formatExternalContext(context: ExternalContext): string {
  switch (context.kind) {
    case "communication-thread":
      return [
        `### Communication Thread: ${context.title}`,
        `Source: ${context.sourceId}`,
        `Participants: ${context.participants.join(", ") || "n/a"}`,
        "",
        ...context.messages.map(
          (message) =>
            `- ${message.timestamp} ${message.author}: ${message.body}`,
        ),
      ].join("\n");

    case "issue-tracker-item":
      return [
        `### Issue: ${context.title}`,
        `Source: ${context.sourceId}`,
        `Status: ${context.status}`,
        `Labels: ${context.labels.join(", ") || "n/a"}`,
        "",
        context.description,
      ].join("\n");

    case "decision-record":
      return [
        `### Decision Record: ${context.title}`,
        `Source: ${context.sourceId}`,
        context.decidedAt ? `Decided At: ${context.decidedAt}` : undefined,
        "",
        `Decision: ${context.decision}`,
        `Rationale: ${context.rationale}`,
      ]
        .filter(Boolean)
        .join("\n");

    case "release-note":
      return [
        `### Release Note: ${context.title}`,
        `Source: ${context.sourceId}`,
        context.releasedAt ? `Released At: ${context.releasedAt}` : undefined,
        "",
        context.body,
        context.relevance ? `Relevance: ${context.relevance}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");

    case "customer-report":
      return [
        `### Customer Report: ${context.title}`,
        `Source: ${context.sourceId}`,
        context.reportedAt ? `Reported At: ${context.reportedAt}` : undefined,
        "",
        context.body,
        context.relevance ? `Relevance: ${context.relevance}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
  }
}

export function renderScenarioPrompt(scenario: UserTestScenario): string {
  const repository = scenario.repositoryInput.workingDocumentationRepository;

  return [
    scenario.userPrompt,
    "Work only from the working documentation repository and attached context below.",
    "First call configure_working_repository with the working repository details below. Do not start docs maintenance until that setup step succeeds.",
    "Then call run_docs_maintenance_scenario with the full scenario and attached context. Do not answer from attached context alone.",
    "Produce a documentation impact report first. Prepare a patch only if the evidence supports it.",
    "",
    "## Working Documentation Repository",
    `URL: ${repository.source.url}`,
    `Ref: ${repository.ref}`,
    `Docs root: ${repository.docsRoot}`,
    `Sandbox path: ${repository.sandboxPath}`,
    `Allowed actions: ${repository.allowedActions.join(", ")}`,
    "",
    "## Attached Context",
    scenario.repositoryInput.externalContext.map(formatExternalContext).join("\n\n"),
  ].join("\n");
}

export function renderScenarioReviewGuide(scenario: UserTestScenario): string {
  const checks = scenario.expected.checks
    .map(
      (check) =>
        `- ${check.required ? "Required" : "Optional"}: \`${check.command}\` - ${check.rationale}`,
    )
    .join("\n");

  return [
    `# ${scenario.title}`,
    "",
    scenario.intent,
    "",
    `Expected outcome: ${scenario.expected.outcome}`,
    "",
    "## Impact Report Must Include",
    scenario.expected.impactReportMustInclude.map((item) => `- ${item}`).join("\n"),
    "",
    "## Expected Touched Files",
    scenario.expected.expectedTouchedFiles.length > 0
      ? scenario.expected.expectedTouchedFiles.map((file) => `- ${file}`).join("\n")
      : "- None",
    "",
    "## Forbidden Touched Files",
    scenario.expected.forbiddenTouchedFiles.length > 0
      ? scenario.expected.forbiddenTouchedFiles.map((file) => `- ${file}`).join("\n")
      : "- None",
    "",
    "## Patch Hints",
    scenario.expected.expectedPatchHints.length > 0
      ? scenario.expected.expectedPatchHints.map((hint) => `- ${hint}`).join("\n")
      : "- None",
    "",
    "## Must Not Do",
    scenario.expected.mustNotDo.map((item) => `- ${item}`).join("\n"),
    "",
    "## Checks",
    checks || "- None",
  ].join("\n");
}
