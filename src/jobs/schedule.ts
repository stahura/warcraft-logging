import { env } from "../config/env.js";
import { isIngestRunning, startIngest } from "./ingest.js";

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  const intervalMs = env.INGEST_CRON_HOURS * 60 * 60 * 1000;
  if (timer) clearInterval(timer);

  timer = setInterval(() => {
    void tick("cron");
  }, intervalMs);

  // Avoid keeping the event loop alive solely for tests if needed.
  timer.unref?.();

  console.log(`[scheduler] ingest every ${env.INGEST_CRON_HOURS} hours`);
}

async function tick(trigger: "cron"): Promise<void> {
  if (isIngestRunning()) {
    console.log("[scheduler] skip: ingest already running");
    return;
  }

  if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
    console.log("[scheduler] skip: WCL credentials not configured");
    return;
  }

  try {
    const result = await startIngest(trigger);
    console.log(`[scheduler] ingest ${result.status}: ${result.message ?? ""}`);
  } catch (err) {
    console.error("[scheduler] ingest error", err);
  }
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
