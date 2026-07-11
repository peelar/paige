import { z } from "zod";

export const docsSignalStatuses = [
  "captured",
  "needs-maintainer-answer",
  "needs-source-evidence",
  "verification-skipped",
  "docs-verified",
  "patch-failed",
  "patch-prepared",
  "draft-pr-opened",
  "closed-already-covered",
  "closed-not-docs-relevant",
] as const;

export const docsSignalStatusSchema = z.enum(docsSignalStatuses);
export type DocsSignalStatus = z.infer<typeof docsSignalStatusSchema>;

export const docsSignalTransitionAuthorities = [
  "intake",
  "triage",
  "verification",
  "patch-handoff",
  "writeback",
] as const;

export type DocsSignalTransitionAuthority =
  (typeof docsSignalTransitionAuthorities)[number];

type TransitionPolicy = Record<
  DocsSignalTransitionAuthority,
  Partial<Record<DocsSignalStatus, readonly DocsSignalStatus[]>>
>;

export const docsSignalTransitionPolicy = {
  intake: {
    captured: [
      "captured",
      "needs-maintainer-answer",
      "needs-source-evidence",
      "verification-skipped",
      "docs-verified",
      "closed-already-covered",
      "closed-not-docs-relevant",
    ],
  },
  triage: {
    captured: ["captured", "needs-maintainer-answer", "needs-source-evidence"],
    "needs-maintainer-answer": [
      "captured",
      "needs-maintainer-answer",
      "needs-source-evidence",
    ],
    "needs-source-evidence": [
      "captured",
      "needs-maintainer-answer",
      "needs-source-evidence",
    ],
    "verification-skipped": ["captured"],
  },
  verification: {
    captured: ["docs-verified"],
    "docs-verified": ["docs-verified"],
  },
  "patch-handoff": {
    "docs-verified": ["patch-failed", "patch-prepared", "closed-already-covered"],
    "patch-failed": ["patch-failed", "patch-prepared", "closed-already-covered"],
  },
  writeback: {
    "patch-prepared": ["draft-pr-opened"],
  },
} as const satisfies TransitionPolicy;

export class DocsSignalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsSignalTransitionError";
  }
}

export function assertDocsSignalTransitionAllowed(input: {
  authority: DocsSignalTransitionAuthority;
  from: DocsSignalStatus;
  to: DocsSignalStatus;
}): void {
  const authorityPolicy = docsSignalTransitionPolicy[input.authority] as Partial<
    Record<DocsSignalStatus, readonly DocsSignalStatus[]>
  >;
  const allowedTargets = authorityPolicy[input.from];

  if (allowedTargets?.includes(input.to) === true) return;

  throw new DocsSignalTransitionError(
    `Docs signal transition ${input.from} -> ${input.to} is not allowed for ${input.authority}.`,
  );
}

const sourceEvidenceRequiredStatuses = new Set<DocsSignalStatus>([
  "docs-verified",
  "patch-failed",
  "patch-prepared",
  "draft-pr-opened",
]);

export function assertDocsSignalTransitionReady(input: {
  authority: DocsSignalTransitionAuthority;
  from: DocsSignalStatus;
  to: DocsSignalStatus;
  missingEvidence: readonly string[];
}): void {
  assertDocsSignalTransitionAllowed(input);

  if (
    sourceEvidenceRequiredStatuses.has(input.to) &&
    input.missingEvidence.length > 0
  ) {
    throw new DocsSignalTransitionError(
      `Docs signal transition ${input.from} -> ${input.to} requires source evidence to be complete.`,
    );
  }
}
