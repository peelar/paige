import "server-only";

import {
  buildOperatorCapabilityReport,
  getOperatorCapabilityReport,
  type OperatorCapabilityReport,
} from "@docs-agent/control-plane";

const TEST_SCENARIO_ENV = "DOCS_AGENT_CAPABILITY_TEST_SCENARIOS";

export type CapabilityReportResult =
  | { state: "ready"; report: OperatorCapabilityReport }
  | { state: "invalid-record" }
  | { state: "database-error" };

export async function resolveCapabilityReport(
  requestedScenario?: string,
): Promise<CapabilityReportResult> {
  if (process.env[TEST_SCENARIO_ENV] === "1") {
    if (requestedScenario === "invalid-record") return { state: "invalid-record" };
    if (requestedScenario === "database-error") return { state: "database-error" };
    return { state: "ready", report: fixtureCapabilityReport() };
  }

  try {
    return { state: "ready", report: await getOperatorCapabilityReport() };
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return { state: "invalid-record" };
    return { state: "database-error" };
  }
}

function fixtureCapabilityReport(): OperatorCapabilityReport {
  return buildOperatorCapabilityReport({
    docsMaintenanceReady: true,
    githubWritebackReady: false,
  });
}
