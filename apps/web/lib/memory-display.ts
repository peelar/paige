import type {
  OperatorMemoryDisplayState,
} from "@docs-agent/control-plane";

export const memoryDisplayLabels: Record<OperatorMemoryDisplayState, string> = {
  proposed: "Proposed",
  "active-fresh": "Active · fresh",
  "active-expired": "Active · expired",
  "active-undated": "Active · no review date",
  stale: "Stale",
  retired: "Retired",
};

export const memoryDisplayStyles: Record<OperatorMemoryDisplayState, string> = {
  proposed: "border-[#aa7e3d]/35 bg-[#f1dfbd] text-[#674515]",
  "active-fresh": "border-[#718251]/35 bg-[#dce4c8] text-[#2f482f]",
  "active-expired": "border-[#b45c3d]/35 bg-[#f0d1c8] text-[#762c22]",
  "active-undated": "border-[#54716a]/30 bg-[#dce8e2] text-[#24463f]",
  stale: "border-[#b45c3d]/35 bg-[#f0d1c8] text-[#762c22]",
  retired: "border-foreground/15 bg-muted text-muted-foreground",
};

export function formatMemoryKind(kind: string): string {
  return kind.replaceAll("_", " ");
}

export function formatMemoryTimestamp(value: string | null): string {
  if (value === null) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}
