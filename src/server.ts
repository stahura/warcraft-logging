import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env.js";
import { startScheduler } from "./jobs/schedule.js";
import { healthRoutes } from "./routes/health.js";
import { metaRoutes } from "./routes/meta.js";
import { aggregateRoutes } from "./routes/aggregate.js";
import { refreshRoutes } from "./routes/refresh.js";
import { jobsRoutes } from "./routes/jobs.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Refresh-Token"],
  }),
);

app.route("/", healthRoutes);
app.route("/", metaRoutes);
app.route("/", aggregateRoutes);
app.route("/", refreshRoutes);
app.route("/", jobsRoutes);

app.get("/v1", (c) =>
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

/** Same-origin proxy so the local UI can read Railway before CORS is deployed. */
app.get("/remote/*", async (c) => {
  const upstream = (process.env.UI_REMOTE_API || "https://warcraft-logging-production.up.railway.app").replace(
    /\/+$/,
    "",
  );
  const path = c.req.path.replace(/^\/remote/, "") || "/";
  const qs = new URL(c.req.url, "http://local").search;
  const res = await fetch(`${upstream}${path}${qs}`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.text();
  return c.body(body, res.status as 200, {
    "Content-Type": res.headers.get("content-type") || "application/json",
  });
});

app.use("/*", serveStatic({ root: "./public" }));

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
