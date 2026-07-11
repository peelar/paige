import { migrateDocsAgentDatabase } from "../agent/lib/db/client.js";

await migrateDocsAgentDatabase();

console.log("Docs Agent database migrations are up to date.");
