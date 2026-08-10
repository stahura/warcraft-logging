import { prisma } from "../db/client.js";
import { companionKey } from "./place.js";

export type CompanionCount = {
  className: string;
  specName: string;
  count: number;
};

export async function recomputeAggregates(params: {
  seasonId: string;
  dungeonId: string;
  className: string;
  specName: string;
}): Promise<void> {
  const slots = await prisma.leaderboardSlot.findMany({
    where: {
      seasonId: params.seasonId,
      dungeonId: params.dungeonId,
      className: params.className,
      specName: params.specName,
    },
    include: {
      run: {
        include: {
          players: true,
        },
      },
    },
    orderBy: { rank: "asc" },
  });

  if (slots.length === 0) {
    await prisma.specDungeonAggregate.deleteMany({
      where: {
        seasonId: params.seasonId,
        dungeonId: params.dungeonId,
        className: params.className,
        specName: params.specName,
      },
    });
    return;
  }

  const keyLevels: number[] = [];
  const dpsValues: number[] = [];
  const places: number[] = [];
  const companionCounts = new Map<string, CompanionCount>();

  for (const slot of slots) {
    keyLevels.push(slot.run.keyLevel);

    const target = slot.run.players.find((p) => p.isTarget);
    const dpsPlayers = slot.run.players
      .filter((p) => p.role.toLowerCase() === "dps" && p.dps != null)
      .sort((a, b) => Number(b.dps) - Number(a.dps));

    if (target?.dps != null) {
      dpsValues.push(target.dps);
      const place =
        dpsPlayers.findIndex((p) => p.id === target.id) >= 0
          ? dpsPlayers.findIndex((p) => p.id === target.id) + 1
          : null;
      if (place != null) places.push(place);

      for (const other of dpsPlayers) {
        if (other.id === target.id) continue;
        const key = companionKey(other.className, other.specName);
        const prev = companionCounts.get(key) ?? {
          className: other.className,
          specName: other.specName,
          count: 0,
        };
        prev.count += 1;
        companionCounts.set(key, prev);
      }
    }
  }

  const companions = [...companionCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  await prisma.specDungeonAggregate.upsert({
    where: {
      seasonId_dungeonId_className_specName: {
        seasonId: params.seasonId,
        dungeonId: params.dungeonId,
        className: params.className,
        specName: params.specName,
      },
    },
    create: {
      seasonId: params.seasonId,
      dungeonId: params.dungeonId,
      className: params.className,
      specName: params.specName,
      sampleSize: slots.length,
      avgKeyLevel: average(keyLevels),
      avgDps: average(dpsValues),
      avgPlace: average(places),
      companionsJson: companions,
      computedAt: new Date(),
    },
    update: {
      sampleSize: slots.length,
      avgKeyLevel: average(keyLevels),
      avgDps: average(dpsValues),
      avgPlace: average(places),
      companionsJson: companions,
      computedAt: new Date(),
    },
  });
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
