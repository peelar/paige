import { defineTool } from "eve/tools";

import {
  scanWatchedRepositories,
  scanWatchedRepositoriesInputSchema,
  scanWatchedRepositoriesResultSchema,
} from "../lib/watched-repository-workflow.js";

export default defineTool({
  description:
    "Scan configured watched repositories for recent release signals, verify candidates in read-only sandbox checkouts, compare them against the working documentation repository, and return a documentation impact report. This tool never writes to watched repositories and never publishes PRs.",
  inputSchema: scanWatchedRepositoriesInputSchema,
  outputSchema: scanWatchedRepositoriesResultSchema,
  execute: scanWatchedRepositories,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        ok: output.ok,
        noWatchedRepositories: output.noWatchedRepositories,
        scannedRepositories: output.scannedRepositories,
        findings: output.findings.map((finding) => ({
          decision: finding.decision,
          watchedRepository: finding.watchedRepository,
          signal: {
            name: finding.signal.name,
            tagName: finding.signal.tagName,
            url: finding.signal.url,
            publishedAt: finding.signal.publishedAt,
            releaseAccess: finding.signal.releaseAccess,
          },
          searchTerms: finding.searchTerms,
          sourceEvidence: finding.sourceEvidence.slice(0, 2),
          docsEvidence: finding.docsEvidence.slice(0, 2),
          consideredDocs: finding.consideredDocs,
          proposedAction: finding.proposedAction,
          uncertainty: finding.uncertainty,
        })),
        actionProvenance: output.actionProvenance,
        rawSandboxToolsPolicy: output.rawSandboxToolsPolicy,
        nextAction:
          "Answer from this scan result. Do not write to watched repositories. Prepare working-docs patches only through a separate approved docs-maintenance and publish flow.",
      },
    };
  },
});
