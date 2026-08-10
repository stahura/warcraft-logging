import { startIngest } from "../jobs/ingest.js";

const result = await startIngest("manual");
console.log(JSON.stringify(result, null, 2));
if (result.status === "failed") process.exit(1);
