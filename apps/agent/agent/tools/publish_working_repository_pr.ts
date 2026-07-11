import { always } from "eve/tools/approval";
import { defineTool } from "eve/tools";

import {
  publishWorkingRepositoryPr,
  publishWorkingRepositoryPrInputSchema,
  publishWorkingRepositoryPrOutputSchema,
} from "../lib/github-writeback.js";

export default defineTool({
  description:
    "After explicit human approval, publish the prepared sandbox diff from the configured working documentation repository to a GitHub draft PR. Call with empty input unless the user explicitly provided base, branch, title, or commit-message overrides; the tool generates safe defaults. This is the only writeback tool and it must not be used for context or source repositories.",
  inputSchema: publishWorkingRepositoryPrInputSchema,
  outputSchema: publishWorkingRepositoryPrOutputSchema,
  approval: always(),
  execute: publishWorkingRepositoryPr,
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        published: output.published,
        repository: output.repository,
        baseBranch: output.baseBranch,
        branchName: output.branchName,
        commitSha: output.commitSha,
        diffHash: output.diffHash,
        changedFiles: output.changedFiles,
        pullRequest: output.pullRequest,
        signal: output.signal === undefined
          ? undefined
          : {
              id: output.signal.id,
              status: output.signal.status,
              sourceSummary: output.signal.sourceSummary,
            },
        checks: output.checks.map((check) => ({
          name: check.name,
          status: check.status,
          exitCode: check.exitCode,
        })),
        approvalPolicy: output.approvalPolicy,
        credentialProvider: output.credentialProvider,
      },
    };
  },
});
