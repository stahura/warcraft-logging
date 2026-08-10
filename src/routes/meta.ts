import { Hono } from "hono";
import { SPEC_ALLOWLIST } from "../config/allowlist.js";
import { prisma } from "../db/client.js";

export const metaRoutes = new Hono();

metaRoutes.get("/v1/meta/dungeons", async (c) => {
  const season = await prisma.season.findFirst({
    where: { active: true },
    include: {
      dungeons: { orderBy: { name: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!season) {
    return c.json({
      season: null,
      dungeons: [],
      note: "No season ingested yet. POST /v1/refresh after configuring WCL credentials.",
    });
  }

  return c.json({
    season: {
      id: season.id,
      zoneId: season.zoneId,
      name: season.name,
      active: season.active,
    },
    dungeons: season.dungeons.map((d) => ({
      id: d.id,
      encounterId: d.encounterId,
      name: d.name,
    })),
  });
});

metaRoutes.get("/v1/meta/classes", async (c) => {
  return c.json({
    allowlist: SPEC_ALLOWLIST,
    note: "Edit src/config/allowlist.ts to add more class/spec pairs.",
  });
});
