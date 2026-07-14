import { defineDynamic, defineSkill } from "eve/skills";

import { resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "turn.started": async (event, context) => {
  const tools = (await resolveDynamicCapabilities(event, context)).toolNames;
  if (!tools.includes("capture_slack_docs_signal") && !tools.includes("capture_linear_docs_signal")) return null;
  return defineSkill({
    description: "Always load before capturing a Slack or Linear documentation signal from the active verified provider turn.",
    markdown: [
      "# Docs Signal Intake",
      "",
      "1. Capture the explicit provider context with its provider-specific capture tool. Use the returned provider-neutral signal and decision as the durable source for the reply.",
      "2. Treat conversation context as provenance, not proof for a public claim.",
      "3. When source evidence is missing, explain what is needed. Do not verify, patch, or publish. State plainly that current docs were not verified and no pull request was published.",
      "4. When the decision requires current-docs verification:",
      "   - if setup is blocked, report the setup boundary and stop;",
      "   - if setup is ready, call `docs_work_manage` with `operation: verify_current_docs` and answer from the repository-corroborated recorded evidence.",
      "5. Do not patch during intake. After verification, a separate request may use `authoring_workspace` with the verified `signalId`, current content hash, ordinary authoring operations, and the shared preparation mode. A localized patch does not require a content plan.",
      "6. Keep provider identifiers and internal decision values out of the human reply when they do not help the reader.",
      "7. Publishing remains a separate, explicitly approved call to `publish_working_repository_pr`.",
    ].join("\n"),
  });
} } });
