import type { RankingPlayer } from "../wcl/queries.js";

export type PlacementResult = {
  place: number;
  targetDps: number;
  dpsPlayers: RankingPlayer[];
};

/**
 * Rank the target player among DPS-only players in the run (1 = highest DPS).
 */
export function computeDpsPlace(
  targetName: string,
  players: RankingPlayer[],
): PlacementResult | null {
  const dpsPlayers = players
    .filter((p) => p.role.toLowerCase() === "dps" && p.dps != null && Number.isFinite(p.dps))
    .map((p) => ({ ...p, dps: Number(p.dps) }))
    .sort((a, b) => (b.dps ?? 0) - (a.dps ?? 0));

  if (dpsPlayers.length === 0) return null;

  const targetIndex = dpsPlayers.findIndex(
    (p) => p.name.toLowerCase() === targetName.toLowerCase(),
  );

  // If role tagging failed, fall back to matching by name among all with DPS.
  if (targetIndex < 0) {
    const byName = players
      .filter((p) => p.dps != null && Number.isFinite(p.dps))
      .map((p) => ({ ...p, dps: Number(p.dps) }))
      .sort((a, b) => (b.dps ?? 0) - (a.dps ?? 0));
    const idx = byName.findIndex((p) => p.name.toLowerCase() === targetName.toLowerCase());
    if (idx < 0) return null;
    return {
      place: idx + 1,
      targetDps: byName[idx]!.dps!,
      dpsPlayers: byName.slice(0, 3),
    };
  }

  return {
    place: targetIndex + 1,
    targetDps: dpsPlayers[targetIndex]!.dps!,
    dpsPlayers: dpsPlayers.slice(0, 3),
  };
}

export function companionKey(className: string, specName: string): string {
  return `${className}:${specName}`;
}
