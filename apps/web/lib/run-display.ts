import type { OperatorProductRunListItem } from "@docs-agent/control-plane";

export const runStateLabels: Record<OperatorProductRunListItem["displayState"], string> = {
  active: "Active",
  "waiting-for-input": "Waiting for input",
  failed: "Failed",
  completed: "Completed",
  expired: "Expired",
};

export const runStateStyles: Record<OperatorProductRunListItem["displayState"], string> = {
  active: "border-sky-700/35 bg-sky-100 text-sky-950",
  "waiting-for-input": "border-amber-700/35 bg-amber-100 text-amber-950",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  completed: "border-emerald-700/35 bg-emerald-100 text-emerald-950",
  expired: "border-foreground/20 bg-muted text-muted-foreground",
};

export function formatRunType(value: string) {
  return value.replaceAll("-", " ");
}

export function formatRunTime(value: string | null) {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export function tokenSummary(run: Pick<OperatorProductRunListItem, "inputTokens" | "outputTokens" | "cacheReadTokens">) {
  return `${run.inputTokens.toLocaleString()} in · ${run.outputTokens.toLocaleString()} out · ${run.cacheReadTokens.toLocaleString()} cache`;
}
