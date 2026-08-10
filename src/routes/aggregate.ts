import { Hono } from "hono";
import { findAllowedSpec } from "../config/allowlist.js";
import { prisma } from "../db/client.js";

export const aggregateRoutes = new Hono();

aggregateRoutes.get("/v1/aggregate/:className/:specName", async (c) => {
  const classNameParam = c.req.param("className");
  const specNameParam = c.req.param("specName");
  const allowed = findAllowedSpec(classNameParam, specNameParam);

  if (!allowed) {
    return c.json(
      {
        error: "Spec not in allowlist",
        requested: { className: classNameParam, specName: specNameParam },
      },
      404,
    );
  }

  const season = await prisma.season.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!season) {
    return c.json({
      className: allowed.className,
      specName: allowed.specName,
      season: null,
      dungeons: [],
      overall: null,
      note: "No data yet. Trigger POST /v1/refresh.",
    });
  }

  const aggregates = await prisma.specDungeonAggregate.findMany({
    where: {
      seasonId: season.id,
      className: allowed.className,
      specName: allowed.specName,
    },
    include: {
      dungeon: true,
    },
    orderBy: {
      dungeon: { name: "asc" },
    },
  });

  const dungeons = aggregates.map((a) => ({
    dungeonId: a.dungeonId,
    encounterId: a.dungeon.encounterId,
    name: a.dungeon.name,
    sampleSize: a.sampleSize,
    avgKeyLevel: round(a.avgKeyLevel, 2),
    avgDps: Math.round(a.avgDps),
    avgPlace: round(a.avgPlace, 2),
    companionDps: a.companionsJson,
    computedAt: a.computedAt,
  }));

  const overall =
    dungeons.length === 0
      ? null
      : {
          dungeonCount: dungeons.length,
          avgKeyLevel: round(
            dungeons.reduce((s, d) => s + d.avgKeyLevel, 0) / dungeons.length,
            2,
          ),
          avgDps: Math.round(dungeons.reduce((s, d) => s + d.avgDps, 0) / dungeons.length),
          avgPlace: round(
            dungeons.reduce((s, d) => s + d.avgPlace, 0) / dungeons.length,
            2,
          ),
        };

  const includeRuns = c.req.query("includeRuns") === "1";
  let runs: unknown[] | undefined;

  if (includeRuns) {
    const slots = await prisma.leaderboardSlot.findMany({
      where: {
        seasonId: season.id,
        className: allowed.className,
        specName: allowed.specName,
      },
      include: {
        dungeon: true,
        run: { include: { players: true } },
      },
      orderBy: [{ dungeon: { name: "asc" } }, { rank: "asc" }],
    });

    runs = slots.map((slot) => {
      const target = slot.run.players.find((p) => p.isTarget);
      const companions = slot.run.players.filter(
        (p) => p.role.toLowerCase() === "dps" && !p.isTarget,
      );
      return {
        dungeon: slot.dungeon.name,
        rank: slot.rank,
        keyLevel: slot.run.keyLevel,
        score: slot.score,
        dps: target?.dps ?? null,
        place: (() => {
          const dps = slot.run.players
            .filter((p) => p.role.toLowerCase() === "dps" && p.dps != null)
            .sort((a, b) => Number(b.dps) - Number(a.dps));
          const idx = dps.findIndex((p) => p.isTarget);
          return idx >= 0 ? idx + 1 : null;
        })(),
        reportUrl: `https://www.warcraftlogs.com/reports/${slot.run.reportCode}#fight=${slot.run.fightId}`,
        companions: companions.map((p) => ({
          name: p.name,
          className: p.className,
          specName: p.specName,
          dps: p.dps,
        })),
      };
    });
  }

  return c.json({
    className: allowed.className,
    specName: allowed.specName,
    season: {
      id: season.id,
      zoneId: season.zoneId,
      name: season.name,
    },
    dungeons,
    overall,
    runs,
  });
});

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
