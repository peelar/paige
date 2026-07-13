import { spawn } from "node:child_process";
import { createServer } from "node:net";

const port = await findAvailablePort();
const child = spawn(
  "pnpm",
  ["exec", "playwright", "test", ...process.argv.slice(2)],
  {
    env: { ...process.env, PLAYWRIGHT_PORT: String(port) },
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      reject(new Error(`Playwright exited after receiving ${signal}.`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local Playwright port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}
