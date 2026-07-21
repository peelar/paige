import assert from "node:assert/strict";

import { test } from "vitest";

import { shareReportInputSchema } from "../agent/tools/share_report";
import { markdownReportFile, reportFilename } from "../slack/report";

test("Markdown reports get safe descriptive filenames", () => {
  assert.equal(
    reportFilename("Saleor 3.22 → 3.23 Upgrade Audit"),
    "saleor-3-22-3-23-upgrade-audit.md",
  );
  assert.equal(reportFilename(" !!! "), "paige-report.md");
});

test("Markdown reports preserve their complete content", () => {
  const file = markdownReportFile({
    answer: "Not exhaustive.",
    markdown: "# Upgrade audit\n\nComplete evidence.",
    title: "Upgrade audit",
    turnSequence: 3,
  });

  assert.equal(file.filename, "upgrade-audit.md");
  assert.equal(file.mimeType, "text/markdown");
  assert.equal(Buffer.from(file.data as ArrayBuffer).toString("utf8"),
    "# Upgrade audit\n\nComplete evidence.");
});

test("report-backed Slack answers enforce the concise response budget", () => {
  const base = {
    markdown: "# Evidence\n\nComplete report.",
    title: "Evidence",
  };
  assert.equal(shareReportInputSchema.safeParse({
    ...base,
    answer: Array.from({ length: 80 }, () => "word").join(" "),
  }).success, true);
  assert.equal(shareReportInputSchema.safeParse({
    ...base,
    answer: Array.from({ length: 81 }, () => "word").join(" "),
  }).success, false);
});
