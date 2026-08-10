import { env } from "../config/env.js";
import { isIngestRunning, startIngest } from "./ingest.js";

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  const intervalMs = env.INGEST_CRON_HOURS * 60 * 60 * 1000;
  if (timer) clearInterval(timer);

  timer = setInterval(() => {
    void tick("cron");
  }, intervalMs);

  timer.unref?.();

  console.log(
    `[scheduler] every ${env.INGEST_CRON_HOURS}h · ${env.INGEST_SPECS_PER_TICK} specs/tick · zone ${env.WCL_ZONE_ID}`,
  );

  // Kick a batch shortly after boot so PTR data starts filling without a manual POST.
  setTimeout(() => {
    void tick("cron");
  }, 15_000).unref?.();
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
    const result = await startIngest(trigger, env.INGEST_LIMIT, {
      specCount: env.INGEST_SPECS_PER_TICK,
    });
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
