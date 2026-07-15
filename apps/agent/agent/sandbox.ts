import { defineSandbox } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";
import { vercel } from "eve/sandbox/vercel";

const backend = process.env.VERCEL || process.env.EVE_SANDBOX_BACKEND === "vercel"
  ? vercel({ networkPolicy: "deny-all" })
  : microsandbox({
      cpus: 2,
      memoryMiB: 4096,
      networkPolicy: "deny-all",
    });

export default defineSandbox({ backend });
