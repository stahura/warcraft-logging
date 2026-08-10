import { Hono } from "hono";
import { env } from "../config/env.js";
import { isIngestRunning, startIngest } from "../jobs/ingest.js";

export const refreshRoutes = new Hono();

refreshRoutes.post("/v1/refresh", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : c.req.header("x-refresh-token") ?? "";

  if (!token || token !== env.REFRESH_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
    return c.json(
      {
        error: "WCL credentials not configured",
        hint: "Set WCL_CLIENT_ID and WCL_CLIENT_SECRET on the service.",
      },
      503,
    );
  }

  if (isIngestRunning()) {
    return c.json({ error: "Ingest already running" }, 409);
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? Number(limitParam) : env.INGEST_LIMIT;

  // Fire-and-await so Railway HTTP timeout can still receive a result for smaller jobs.
  // For large backfills, client can poll GET /v1/jobs.
  const wait = c.req.query("wait") !== "0";

  if (!wait) {
    void startIngest("manual", Number.isFinite(limit) ? limit : env.INGEST_LIMIT).catch((err) => {
      console.error("[refresh] background ingest failed", err);
    });
    return c.json({ accepted: true, status: "started" }, 202);
  }

  const result = await startIngest("manual", Number.isFinite(limit) ? limit : env.INGEST_LIMIT);
  return c.json(result, result.status === "failed" ? 500 : 200);
});
