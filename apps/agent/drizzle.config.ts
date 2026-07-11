import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./agent/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
