import { defineSandbox, type SandboxNetworkPolicy } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";
import { vercel } from "eve/sandbox/vercel";

import { GITHUB_SANDBOX_NETWORK_ALLOWLIST } from "./lib/repository-contract.js";

const githubOnlyNetworkPolicy = {
  allow: [...GITHUB_SANDBOX_NETWORK_ALLOWLIST],
  subnets: {
    deny: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"],
  },
} satisfies SandboxNetworkPolicy;

const sandboxBackend = process.env.VERCEL || process.env.EVE_SANDBOX_BACKEND === "vercel"
  ? vercel({ networkPolicy: githubOnlyNetworkPolicy })
  : microsandbox({ networkPolicy: githubOnlyNetworkPolicy });

export default defineSandbox({
  backend: sandboxBackend,
});
