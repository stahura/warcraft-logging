import { Hono } from "hono";
import { prisma } from "../db/client.js";
import { isIngestRunning } from "../jobs/ingest.js";

export const jobsRoutes = new Hono();

jobsRoutes.get("/v1/jobs", async (c) => {
  const jobs = await prisma.ingestJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return c.json({
    ingestRunning: isIngestRunning(),
    jobs,
  });
});

jobsRoutes.get("/v1/jobs/:id", async (c) => {
  const job = await prisma.ingestJob.findUnique({ where: { id: c.req.param("id") } });
  if (!job) return c.json({ error: "Not found" }, 404);
  return c.json(job);
});
