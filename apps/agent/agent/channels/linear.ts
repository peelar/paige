import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  DEFAULT_LINEAR_CONNECTOR,
  resolveLinearConnector,
  LINEAR_CONNECTOR_ENV,
} from "@docs-agent/control-plane/provider-config";
import { recordConnectorDeliveryVerification } from "@docs-agent/control-plane/agent";
import { defaultLinearAuth, linearChannel } from "eve/channels/linear";

export { DEFAULT_LINEAR_CONNECTOR, LINEAR_CONNECTOR_ENV };

const linearConnector = resolveLinearConnector();

export default linearChannel({
  credentials: connectLinearCredentials(linearConnector),
  async onAgentSession(_context, event) {
    await recordConnectorDeliveryVerification({
      provider: "linear",
      evidence: "linear-agent-session-webhook",
    });
    if (event.action !== "created" && event.action !== "prompted") return null;
    return { auth: defaultLinearAuth(event) };
  },
});
