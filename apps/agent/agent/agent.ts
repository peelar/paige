import { defineAgent } from "eve";

const gatewayModel = process.env.EVE_GATEWAY_MODEL ?? "zai/glm-5.2";

export default defineAgent({
  model: gatewayModel,
});
