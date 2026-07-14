import type { UserTestScenario } from "./schema";

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
  const outcomeGuidance = scenario.expected.outcome === "docs-patch"
    ? [
        "If the repository evidence confirms a gap, inspect repository conventions and use an available reversible repository-authoring capability for the smallest focused draft and checks.",
        "Return the changed file and diff, but do not publish it.",
      ]
    : [
        "If the repository evidence shows the docs are already accurate, run the named clean-diff check and inspect the exported diff.",
        "Do not create a draft for an already-covered case.",
      ];

  return [
    scenario.userPrompt,
    "Work only from the working documentation repository and attached context below.",
    "Load the docs-maintenance skill before repository work.",
    "First call configure_working_repository with prepareNow false, the working repository details below, and the attached context. Do not start docs maintenance until setup succeeds.",
    "This is direct session-local documentation maintenance, not provider or signal intake. Do not create a docs signal or use signal-specific verification or patch tools.",
    "Compose the available repository search, file-read, named-check, and reversible authoring capabilities around the evidence this case needs. Do not use raw shell or unrestricted filesystem tools.",
    `Likely current-documentation paths: ${scenario.expected.inspectedPaths.join(", ")}. Verify them rather than assuming they are correct.`,
    "Stay focused on those likely paths and their relevant sections unless repository evidence points elsewhere.",
    "Inspect current documentation before deciding; attached context alone is not enough.",
    ...outcomeGuidance,
    "Produce a documentation impact report first. Prepare a patch only if the evidence supports it.",
    "Publishing is outside this request and still requires separate explicit approval.",
    "",
    "## Working Documentation Repository",
    `URL: ${repository.source.url}`,
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
