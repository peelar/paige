import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.EVE_GATEWAY_MODEL ?? "zai/glm-5.2",
});
