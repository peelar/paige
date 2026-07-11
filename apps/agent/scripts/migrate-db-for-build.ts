import { migrateDocsAgentDatabase } from "../agent/lib/db/client.js";

if (process.env.VERCEL === "1") {
  await migrateDocsAgentDatabase();
  console.log("Docs Agent database migrations are up to date for deployment.");
} else {
  console.log("Skipping deployment database migration outside Vercel.");
}
