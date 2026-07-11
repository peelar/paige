import { connectLinearCredentials } from "@vercel/connect/eve";
import { linearChannel } from "eve/channels/linear";

export const LINEAR_CONNECTOR_ENV = "DOCS_AGENT_LINEAR_CONNECTOR";
export const DEFAULT_LINEAR_CONNECTOR = "linear/docs-agent";

const linearConnector =
  process.env[LINEAR_CONNECTOR_ENV]?.trim() || DEFAULT_LINEAR_CONNECTOR;

export default linearChannel({
  credentials: connectLinearCredentials(linearConnector),
});
