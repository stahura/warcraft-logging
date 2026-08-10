import { Hono } from "hono";
import { prisma } from "../db/client.js";
import { isIngestRunning } from "../jobs/ingest.js";
import { env } from "../config/env.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return c.json({
    ok: dbOk,
    db: dbOk ? "up" : "down",
    ingestRunning: isIngestRunning(),
    wclConfigured: Boolean(env.WCL_CLIENT_ID && env.WCL_CLIENT_SECRET),
    allowlist: ["Evoker/Devastation"],
  });
});
