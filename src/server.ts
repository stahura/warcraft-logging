import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "./config/env.js";
import { startScheduler } from "./jobs/schedule.js";
import { healthRoutes } from "./routes/health.js";
import { metaRoutes } from "./routes/meta.js";
import { aggregateRoutes } from "./routes/aggregate.js";
import { refreshRoutes } from "./routes/refresh.js";
import { jobsRoutes } from "./routes/jobs.js";

const app = new Hono();

app.route("/", healthRoutes);
app.route("/", metaRoutes);
app.route("/", aggregateRoutes);
app.route("/", refreshRoutes);
app.route("/", jobsRoutes);

app.get("/", (c) =>
  c.json({
    name: "warcraft-logging",
    description: "Mythic+ top-run aggregator for allowlisted specs (v1: Devastation Evoker)",
    endpoints: [
      "GET /health",
      "GET /v1/meta/dungeons",
      "GET /v1/meta/classes",
      "GET /v1/aggregate/:className/:specName?includeRuns=1",
      "GET /v1/jobs",
      "POST /v1/refresh",
    ],
  }),
);

startScheduler();

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`);
  },
);
