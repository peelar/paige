import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

loadEnvFile(fileURLToPath(new URL(".env.local", import.meta.url)));

// Drizzle Kit requires its configuration as a default export. This tooling
// file follows that contract instead of Paige's application module convention.
export default defineConfig({
  dialect: "turso",
  schema: [
    "./repositories/configuration/schema.ts",
    "./sessions/schema.ts",
  ],
  dbCredentials: {
    url: process.env.PAIGE_DATABASE_URL!,
    authToken: process.env.PAIGE_DATABASE_AUTH_TOKEN!,
  },
});
