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
  const allSpecs = c.req.query("all") === "1";
  const countParam = c.req.query("specs");
  const specCount = countParam ? Number(countParam) : env.INGEST_SPECS_PER_TICK;

  const wait = c.req.query("wait") !== "0";
  const options = {
    allSpecs,
    specCount: Number.isFinite(specCount) ? specCount : env.INGEST_SPECS_PER_TICK,
  };

  if (!wait) {
    void startIngest("manual", Number.isFinite(limit) ? limit : env.INGEST_LIMIT, options).catch(
      (err) => {
        console.error("[refresh] background ingest failed", err);
      },
    );
    return c.json(
      {
        accepted: true,
        status: "started",
        mode: allSpecs ? "all-specs" : `next-${options.specCount}-specs`,
        zoneId: env.WCL_ZONE_ID,
      },
      202,
    );
  }

  const result = await startIngest(
    "manual",
    Number.isFinite(limit) ? limit : env.INGEST_LIMIT,
    options,
  );
  return c.json(result, result.status === "failed" ? 500 : 200);
});
