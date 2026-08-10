import { Hono } from "hono";
import { SPEC_ALLOWLIST, formatSpecLabel } from "../config/allowlist.js";
import { prisma } from "../db/client.js";

export const compareRoutes = new Hono();

compareRoutes.get("/v1/compare", async (c) => {
  const season = await prisma.season.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!season) {
    return c.json({
      season: null,
      specs: [],
      byDungeon: [],
      note: "No data yet. Trigger POST /v1/refresh.",
    });
  }

  const aggregates = await prisma.specDungeonAggregate.findMany({
    where: { seasonId: season.id },
    include: { dungeon: true },
  });

  const specs = SPEC_ALLOWLIST.map((target) => {
    const rows = aggregates.filter(
      (a) =>
        a.className === target.className &&
        a.specName === target.specName,
    );

    const dungeons = rows
      .map((a) => ({
        dungeonId: a.dungeonId,
        encounterId: a.dungeon.encounterId,
        name: a.dungeon.name,
        sampleSize: a.sampleSize,
        avgKeyLevel: round(a.avgKeyLevel, 2),
        avgDps: Math.round(a.avgDps),
        avgPlace: round(a.avgPlace, 2),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const overall =
      dungeons.length === 0
        ? null
        : {
            dungeonCount: dungeons.length,
            avgKeyLevel: round(
              dungeons.reduce((s, d) => s + d.avgKeyLevel, 0) / dungeons.length,
              2,
            ),
            avgDps: Math.round(
              dungeons.reduce((s, d) => s + d.avgDps, 0) / dungeons.length,
            ),
            avgPlace: round(
              dungeons.reduce((s, d) => s + d.avgPlace, 0) / dungeons.length,
              2,
            ),
          };

    return {
      className: target.className,
      specName: target.specName,
      label: formatSpecLabel(target),
      overall,
      dungeons,
    };
  });

  const dungeonNames = [
    ...new Set(aggregates.map((a) => a.dungeon.name)),
  ].sort((a, b) => a.localeCompare(b));

  const byDungeon = dungeonNames.map((name) => {
    const entries = SPEC_ALLOWLIST.map((target) => {
      const row = aggregates.find(
        (a) =>
          a.dungeon.name === name &&
          a.className === target.className &&
          a.specName === target.specName,
      );
      if (!row) return null;
      return {
        className: target.className,
        specName: target.specName,
        label: formatSpecLabel(target),
        sampleSize: row.sampleSize,
        avgKeyLevel: round(row.avgKeyLevel, 2),
        avgDps: Math.round(row.avgDps),
        avgPlace: round(row.avgPlace, 2),
      };
    }).filter((e): e is NonNullable<typeof e> => e != null);

    // Best place = lowest avgPlace (1 is first among the 3 DPS).
    const best =
      entries.length === 0
        ? null
        : [...entries].sort((a, b) => a.avgPlace - b.avgPlace)[0]!;

    return {
      name,
      encounterId: aggregates.find((a) => a.dungeon.name === name)?.dungeon.encounterId ?? null,
      entries,
      best,
    };
  });

  return c.json({
    season: {
      id: season.id,
      zoneId: season.zoneId,
      name: season.name,
    },
    specs,
    byDungeon,
  });
});

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
