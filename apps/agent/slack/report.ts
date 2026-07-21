import type { FileUpload } from "chat";
import { defineState } from "eve/context";

export interface PendingSlackReport {
  readonly answer: string;
  readonly markdown: string;
  readonly title: string;
  readonly turnSequence: number;
}

// A report belongs to the turn that produced it. Keeping that identity in
// durable session state prevents a failed or abandoned turn from attaching
// stale evidence to the user's next answer.
export const pendingSlackReport = defineState<PendingSlackReport | null>(
  "paige.slack.pending-report",
  () => null,
);

export function markdownReportFile(report: PendingSlackReport): FileUpload {
  return {
    data: Buffer.from(report.markdown, "utf8"),
    filename: reportFilename(report.title),
    mimeType: "text/markdown",
  };
}

export function reportFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 72)
    .replace(/-+$/gu, "");
  return `${slug || "paige-report"}.md`;
}
