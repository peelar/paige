import { z } from "zod";

export const legacyImpactDecisionSchema = z.enum([
  "docs-patch",
  "no-docs-change",
  "changelog-only",
  "ask-maintainer",
]);

export const docsImpactDecisionSchema = z.enum([
  "not-docs-relevant",
  "needs-maintainer-answer",
  "needs-source-evidence",
  "needs-docs-verification",
  "verification-skipped",
  "already-covered",
  "likely-stale",
  "docs-patch-recommended",
  "changelog-only",
]);

export const docsImpactEvidenceKindSchema = z.enum([
  "signal-source",
  "source-repository",
  "release",
  "working-docs",
  "maintainer",
  "system",
]);

export const currentDocsVerificationStateSchema = z.enum([
  "not-needed",
  "needed",
  "blocked",
  "completed",
]);

export const docsImpactNextActionSchema = z.enum([
  "close-signal",
  "ask-maintainer",
  "collect-source-evidence",
  "verify-current-docs",
  "prepare-docs-patch",
  "prepare-changelog",
  "no-action",
]);

export const docsImpactEvidenceSchema = z.object({
  kind: docsImpactEvidenceKindSchema,
  summary: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
});

export const currentDocsVerificationSchema = z.object({
  state: currentDocsVerificationStateSchema,
  reason: z.string().trim().min(1),
  repository: z.string().trim().min(1).optional(),
  ref: z.string().trim().min(1).optional(),
  checkedAt: z.string().trim().min(1).optional(),
  consideredPages: z.array(z.string().trim().min(1)).default([]),
  evidence: z.array(docsImpactEvidenceSchema).default([]),
});

export const docsImpactDecisionRecordSchema = z.object({
  decision: docsImpactDecisionSchema,
  reason: z.string().trim().min(1),
  evidence: z.array(docsImpactEvidenceSchema).default([]),
  missingEvidence: z.array(z.string().trim().min(1)).default([]),
  currentDocsVerification: currentDocsVerificationSchema,
  recommendedNextAction: docsImpactNextActionSchema,
  uncertainty: z.array(z.string().trim().min(1)).default([]),
});

export const docsImpactTriageInputSchema = z.object({
  signalSummary: z.string().trim().min(1),
  publicDocsImpact: z.enum([
    "none",
    "internal-only",
    "unclear",
    "substantive",
  ]),
  sourceEvidence: z.enum(["not-needed", "missing", "available"]).default("not-needed"),
  currentDocsState: z
    .enum(["not-run", "already-covered", "likely-stale", "patch-recommended", "changelog-only"])
    .default("not-run"),
  evidence: z.array(docsImpactEvidenceSchema).default([]),
  missingEvidence: z.array(z.string().trim().min(1)).default([]),
  uncertainty: z.array(z.string().trim().min(1)).default([]),
  skippedVerificationReason: z.string().trim().min(1).optional(),
});

export type LegacyImpactDecision = z.infer<typeof legacyImpactDecisionSchema>;
export type DocsImpactDecision = z.infer<typeof docsImpactDecisionSchema>;
export type DocsImpactDecisionRecord = z.infer<typeof docsImpactDecisionRecordSchema>;
export type DocsImpactTriageInput = z.infer<typeof docsImpactTriageInputSchema>;

export function mapLegacyImpactDecision(
  decision: LegacyImpactDecision,
): DocsImpactDecision {
  switch (decision) {
    case "docs-patch":
      return "docs-patch-recommended";
    case "no-docs-change":
      return "already-covered";
    case "changelog-only":
      return "changelog-only";
    case "ask-maintainer":
      return "needs-maintainer-answer";
  }
}

export function shouldVerifyCurrentDocs(decision: DocsImpactDecisionRecord): boolean {
  return decision.currentDocsVerification.state === "needed" ||
    decision.recommendedNextAction === "verify-current-docs";
}

export function planDocsImpactDecision(
  input: DocsImpactTriageInput,
): DocsImpactDecisionRecord {
  const parsed = docsImpactTriageInputSchema.parse(input);

  if (parsed.publicDocsImpact === "none") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "not-docs-relevant",
      reason: "The signal does not describe a plausible public documentation concern.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: {
        state: "not-needed",
        reason: "No public documentation concern was identified.",
      },
      recommendedNextAction: "close-signal",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.publicDocsImpact === "internal-only") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "verification-skipped",
      reason: parsed.skippedVerificationReason ??
        "The signal is internal-only, so current docs verification is not needed.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: {
        state: "not-needed",
        reason: parsed.skippedVerificationReason ??
          "Internal-only signals should not trigger sandboxed docs inspection.",
      },
      recommendedNextAction: "close-signal",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.publicDocsImpact === "unclear") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "needs-maintainer-answer",
      reason: "The signal is ambiguous and needs a maintainer answer before repository work.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: {
        state: "blocked",
        reason: "The workflow should wait for maintainer clarification before opening the sandbox.",
      },
      recommendedNextAction: "ask-maintainer",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.sourceEvidence === "missing") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "needs-source-evidence",
      reason:
        "The signal may affect public docs, but source or release evidence is missing.",
      evidence: parsed.evidence,
      missingEvidence:
        parsed.missingEvidence.length > 0
          ? parsed.missingEvidence
          : ["Source or release evidence confirming the public behavior change."],
      currentDocsVerification: {
        state: "blocked",
        reason:
          "Slack, Linear, or other discussion context alone is not enough proof for a public docs claim.",
      },
      recommendedNextAction: "collect-source-evidence",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.currentDocsState === "not-run") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "needs-docs-verification",
      reason:
        "The signal is substantive and evidence-backed, so current docs should be verified.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: {
        state: "needed",
        reason:
          "Substantive product, API, release, or behavior signals should inspect the configured working documentation repository.",
      },
      recommendedNextAction: "verify-current-docs",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.currentDocsState === "already-covered") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "already-covered",
      reason: "Current docs were verified and already cover the signal.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: completedVerification(
        "The working documentation repository was inspected and already covers the signal.",
        parsed.evidence,
      ),
      recommendedNextAction: "close-signal",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.currentDocsState === "likely-stale") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "likely-stale",
      reason: "Current docs were verified and appear stale or incomplete.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: completedVerification(
        "The working documentation repository was inspected and appears stale.",
        parsed.evidence,
      ),
      recommendedNextAction: "prepare-docs-patch",
      uncertainty: parsed.uncertainty,
    });
  }

  if (parsed.currentDocsState === "patch-recommended") {
    return docsImpactDecisionRecordSchema.parse({
      decision: "docs-patch-recommended",
      reason: "Current docs were verified and a minimal docs patch is recommended.",
      evidence: parsed.evidence,
      missingEvidence: parsed.missingEvidence,
      currentDocsVerification: completedVerification(
        "The working documentation repository was inspected and needs a docs patch.",
        parsed.evidence,
      ),
      recommendedNextAction: "prepare-docs-patch",
      uncertainty: parsed.uncertainty,
    });
  }

  return docsImpactDecisionRecordSchema.parse({
    decision: "changelog-only",
    reason:
      "The verified docs impact is release-note or changelog-shaped rather than a docs page patch.",
    evidence: parsed.evidence,
    missingEvidence: parsed.missingEvidence,
    currentDocsVerification: completedVerification(
      "The working documentation repository was inspected and no docs page patch is recommended.",
      parsed.evidence,
    ),
    recommendedNextAction: "prepare-changelog",
    uncertainty: parsed.uncertainty,
  });
}

function completedVerification(
  reason: string,
  evidence: z.infer<typeof docsImpactEvidenceSchema>[],
): z.infer<typeof currentDocsVerificationSchema> {
  return {
    state: "completed",
    reason,
    consideredPages: [],
    evidence: evidence.filter((item) => item.kind === "working-docs"),
  };
}
