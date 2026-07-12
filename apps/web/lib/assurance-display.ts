import type {
  OperatorValidationRunListItem,
  ValidationRun,
} from "@docs-agent/control-plane";

export const assuranceOutcomeLabels: Record<
  OperatorValidationRunListItem["displayOutcome"],
  string
> = {
  missing: "Missing",
  skipped: "Skipped",
  flaky: "Flaky",
  failed: "Failed",
  passed: "Passed",
  expired: "Expired",
};

export const assuranceOutcomeStyles: Record<
  OperatorValidationRunListItem["displayOutcome"],
  string
> = {
  missing: "border-slate-600/35 bg-slate-100 text-slate-900",
  skipped: "border-sky-700/35 bg-sky-100 text-sky-950",
  flaky: "border-amber-700/35 bg-amber-100 text-amber-950",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  passed: "border-emerald-700/35 bg-emerald-100 text-emerald-950",
  expired: "border-foreground/20 bg-muted text-muted-foreground",
};

export function formatAssuranceKind(value: ValidationRun["kind"]) {
  return value === "live-eval" ? "Live model eval" : "Deterministic validation";
}

export function formatAssuranceTime(value: string | null) {
  if (value === null) return "Not completed";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatDuration(value: number | null) {
  if (value === null) return "Still open";
  if (value < 1_000) return `${value} ms`;
  const seconds = Math.round(value / 100) / 10;
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes} min ${remainder} sec`;
}

export function caseCountSummary(
  counts: OperatorValidationRunListItem["caseCounts"],
) {
  return (["failed", "flaky", "missing", "skipped", "passed"] as const)
    .filter((outcome) => counts[outcome] > 0)
    .map((outcome) => `${counts[outcome]} ${outcome}`)
    .join(" · ");
}
