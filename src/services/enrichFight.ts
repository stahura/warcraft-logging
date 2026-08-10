import {
  fetchFightPlayerThroughput,
  guessRole,
  type RankingPlayer,
  type RankingRow,
} from "../wcl/queries.js";
import { computeDpsPlace } from "./place.js";

export type EnrichedFight = {
  reportCode: string;
  fightId: number;
  keyLevel: number;
  score: number;
  durationMs?: number;
  startTime?: Date;
  targetName: string;
  targetClass: string;
  targetSpec: string;
  targetDps: number;
  place: number;
  players: RankingPlayer[];
};

export async function enrichRankingRow(row: RankingRow): Promise<EnrichedFight> {
  let players = normalizeCompanionList(row);

  const needsThroughput =
    players.filter((p) => p.role === "DPS" && p.dps != null).length < 3 ||
    !players.some((p) => p.name.toLowerCase() === row.name.toLowerCase() && p.dps != null);

  if (needsThroughput) {
    const fromReport = await fetchFightPlayerThroughput({
      reportCode: row.reportCode,
      fightId: row.fightId,
    });
    players = mergePlayers(players, fromReport);
  }

  // Ensure the ranked character exists in the player list.
  if (!players.some((p) => p.name.toLowerCase() === row.name.toLowerCase())) {
    players.push({
      name: row.name,
      className: row.className,
      specName: row.specName,
      role: "DPS",
      serverSlug: row.serverSlug,
      region: row.region,
    });
  }

  // Force target role to DPS for placement math.
  players = players.map((p) =>
    p.name.toLowerCase() === row.name.toLowerCase() ? { ...p, role: "DPS" } : p,
  );

  const placement = computeDpsPlace(row.name, players);
  if (!placement) {
    throw new Error(
      `Could not compute DPS place for ${row.name} in ${row.reportCode}#${row.fightId}`,
    );
  }

  return {
    reportCode: row.reportCode,
    fightId: row.fightId,
    keyLevel: row.keyLevel,
    score: row.score,
    durationMs: row.durationMs,
    startTime: row.startTime ? new Date(row.startTime) : undefined,
    targetName: row.name,
    targetClass: row.className,
    targetSpec: row.specName,
    targetDps: placement.targetDps,
    place: placement.place,
    players: ensureRoles(players),
  };
}

function normalizeCompanionList(row: RankingRow): RankingPlayer[] {
  const players = row.companions.map((p) => ({
    ...p,
    role: p.role || guessRole(p.specName, p.className),
  }));

  if (!players.some((p) => p.name.toLowerCase() === row.name.toLowerCase())) {
    players.push({
      name: row.name,
      className: row.className,
      specName: row.specName,
      role: "DPS",
      serverSlug: row.serverSlug,
      region: row.region,
    });
  }

  return players;
}

function mergePlayers(base: RankingPlayer[], extra: RankingPlayer[]): RankingPlayer[] {
  const map = new Map<string, RankingPlayer>();
  for (const p of [...base, ...extra]) {
    const key = p.name.toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, p);
      continue;
    }
    map.set(key, {
      ...prev,
      ...p,
      dps: p.dps ?? prev.dps,
      role: p.role || prev.role,
      className: p.className !== "Unknown" ? p.className : prev.className,
      specName: p.specName !== "Unknown" ? p.specName : prev.specName,
    });
  }
  return [...map.values()];
}

function ensureRoles(players: RankingPlayer[]): RankingPlayer[] {
  return players.map((p) => ({
    ...p,
    role: p.role || guessRole(p.specName, p.className),
  }));
}
