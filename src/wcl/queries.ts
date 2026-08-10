import { wclGraphql } from "./graphql.js";

export type WclZone = {
  id: number;
  name: string;
  frozen: boolean;
  encounters: Array<{ id: number; name: string }>;
};

export type RankingPlayer = {
  name: string;
  className: string;
  specName: string;
  role: string;
  dps?: number;
  serverSlug?: string;
  region?: string;
};

export type RankingRow = {
  name: string;
  className: string;
  specName: string;
  score: number;
  reportCode: string;
  fightId: number;
  keyLevel: number;
  durationMs?: number;
  startTime?: number;
  serverSlug?: string;
  region?: string;
  companions: RankingPlayer[];
};

type ZonesQuery = {
  worldData: {
    zones: Array<{
      id: number;
      name: string;
      frozen: boolean;
      encounters: Array<{ id: number; name: string } | null> | null;
    } | null> | null;
  } | null;
};

type RankingsQuery = {
  worldData: {
    encounter: {
      id: number;
      name: string;
      characterRankings: unknown;
    } | null;
  } | null;
};

type ReportEnrichQuery = {
  reportData: {
    report: {
      code: string;
      playerDetails: unknown;
      table: unknown;
    } | null;
  } | null;
};

type RateLimitQuery = {
  rateLimitData: {
    limitPerHour: number;
    pointsSpentThisHour: number;
    pointsResetIn: number;
  } | null;
};

export async function fetchRateLimit() {
  const data = await wclGraphql<RateLimitQuery>(`
    query RateLimit {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
    }
  `);
  return data.rateLimitData;
}

export async function fetchMythicPlusZones(): Promise<WclZone[]> {
  const data = await wclGraphql<ZonesQuery>(`
    query Zones {
      worldData {
        zones {
          id
          name
          frozen
          encounters {
            id
            name
          }
        }
      }
    }
  `);

  const zones = (data.worldData?.zones ?? [])
    .filter((z): z is NonNullable<typeof z> => Boolean(z))
    .map((z) => ({
      id: z.id,
      name: z.name,
      frozen: z.frozen,
      encounters: (z.encounters ?? [])
        .filter((e): e is { id: number; name: string } => Boolean(e))
        .map((e) => ({ id: e.id, name: e.name })),
    }));

  // Prefer active (unfrozen) Mythic+ / dungeon seasonal zones with multiple encounters.
  const mythicPlus = zones.filter((z) => {
    const name = z.name.toLowerCase();
    const looksLikeMplus =
      name.includes("mythic+") ||
      name.includes("mythic plus") ||
      name.includes("m+") ||
      (name.includes("season") && name.includes("dungeon"));
    return looksLikeMplus && z.encounters.length >= 4;
  });

  if (mythicPlus.length === 0) {
    // Fallback: unfrozen zones with 8-ish dungeon encounters.
    return zones.filter((z) => !z.frozen && z.encounters.length >= 6 && z.encounters.length <= 12);
  }

  return mythicPlus;
}

export function pickActiveSeasonZone(zones: WclZone[]): WclZone {
  const unfrozen = zones.filter((z) => !z.frozen);
  const pool = unfrozen.length > 0 ? unfrozen : zones;
  // Highest zone id is usually the newest season.
  return [...pool].sort((a, b) => b.id - a.id)[0]!;
}

export async function fetchCharacterRankings(params: {
  encounterId: number;
  className: string;
  specName: string;
  page?: number;
  includeOtherPlayers?: boolean;
}): Promise<RankingRow[]> {
  const includeOtherPlayers = params.includeOtherPlayers ?? true;

  const queryWithOthers = `
    query CharacterRankings(
      $encounterId: Int!
      $className: String!
      $specName: String!
      $page: Int
      $includeOtherPlayers: Boolean
    ) {
      worldData {
        encounter(id: $encounterId) {
          id
          name
          characterRankings(
            className: $className
            specName: $specName
            metric: playerscore
            page: $page
            includeOtherPlayers: $includeOtherPlayers
            includeCombatantInfo: true
          )
        }
      }
    }
  `;

  const queryBasic = `
    query CharacterRankings(
      $encounterId: Int!
      $className: String!
      $specName: String!
      $page: Int
    ) {
      worldData {
        encounter(id: $encounterId) {
          id
          name
          characterRankings(
            className: $className
            specName: $specName
            metric: playerscore
            page: $page
            includeCombatantInfo: true
          )
        }
      }
    }
  `;

  const variables = {
    encounterId: params.encounterId,
    className: params.className,
    specName: params.specName,
    page: params.page ?? 1,
    includeOtherPlayers,
  };

  let data: RankingsQuery;
  try {
    data = await wclGraphql<RankingsQuery>(queryWithOthers, variables);
  } catch (err) {
    // Some schema builds reject includeOtherPlayers; retry without it.
    const message = err instanceof Error ? err.message : String(err);
    if (!includeOtherPlayers || !/includeOtherPlayers|Unknown argument/i.test(message)) {
      throw err;
    }
    data = await wclGraphql<RankingsQuery>(queryBasic, variables);
  }

  const raw = data.worldData?.encounter?.characterRankings;
  return parseRankingPayload(raw, params.className, params.specName);
}

export async function fetchFightPlayerThroughput(params: {
  reportCode: string;
  fightId: number;
}): Promise<RankingPlayer[]> {
  const data = await wclGraphql<ReportEnrichQuery>(
    `
    query FightEnrich($code: String!, $fightIDs: [Int]) {
      reportData {
        report(code: $code) {
          code
          playerDetails(fightIDs: $fightIDs, includeCombatantInfo: true)
          table(dataType: DamageDone, fightIDs: $fightIDs, hostilityType: Friendlies)
        }
      }
    }
  `,
    {
      code: params.reportCode,
      fightIDs: [params.fightId],
    },
  );

  const report = data.reportData?.report;
  if (!report) return [];

  const detailsByName = parsePlayerDetails(report.playerDetails);
  const damageRows = parseDamageTable(report.table);

  const merged = new Map<string, RankingPlayer>();

  for (const row of damageRows) {
    const detail = detailsByName.get(row.name.toLowerCase());
    merged.set(row.name.toLowerCase(), {
      name: row.name,
      className: detail?.className ?? row.className ?? "Unknown",
      specName: detail?.specName ?? row.specName ?? "Unknown",
      role: detail?.role ?? guessRole(detail?.specName ?? row.specName, detail?.className ?? row.className),
      dps: row.dps,
      serverSlug: detail?.serverSlug,
      region: detail?.region,
    });
  }

  // Include players present in details but missing from damage table.
  for (const [key, detail] of detailsByName) {
    if (!merged.has(key)) {
      merged.set(key, { ...detail, dps: undefined });
    }
  }

  return [...merged.values()];
}

function parseRankingPayload(raw: unknown, className: string, specName: string): RankingRow[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const rankings = Array.isArray(root.rankings) ? root.rankings : Array.isArray(raw) ? raw : [];

  const rows: RankingRow[] = [];
  for (const entry of rankings) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;

    const reportCode = String(r.reportID ?? r.reportCode ?? r.code ?? "");
    const fightId = Number(r.fightID ?? r.fightId ?? r.fight ?? 0);
    if (!reportCode || !fightId) continue;

    const keyLevel = Number(
      r.bracketData ?? r.keystoneLevel ?? r.hardModeLevel ?? r.size ?? 0,
    );

    const companions = parseCompanionPlayers(r);

    rows.push({
      name: String(r.name ?? "Unknown"),
      className: String(r.class ?? r.className ?? className),
      specName: String(r.spec ?? r.specName ?? specName),
      score: Number(r.amount ?? r.score ?? 0),
      reportCode,
      fightId,
      keyLevel: Number.isFinite(keyLevel) ? keyLevel : 0,
      durationMs: r.duration != null ? Number(r.duration) : undefined,
      startTime: r.startTime != null ? Number(r.startTime) : undefined,
      serverSlug: asString(asRecord(r.server)?.slug) ?? asString(r.serverSlug),
      region: asString(asRecord(r.server)?.region) ?? asString(r.serverRegion),
      companions,
    });
  }

  return rows;
}

function parseCompanionPlayers(ranking: Record<string, unknown>): RankingPlayer[] {
  const candidates = [ranking.team, ranking.players, ranking.otherPlayers, ranking.companions];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const players: RankingPlayer[] = [];
    for (const item of candidate) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      const name = String(p.name ?? "");
      if (!name) continue;
      const className = String(p.class ?? p.className ?? "Unknown");
      const specName = String(p.spec ?? p.specName ?? "Unknown");
      const role = String(p.role ?? guessRole(specName, className));
      const dps =
        p.dps != null
          ? Number(p.dps)
          : p.amount != null && String(p.metric ?? "").toLowerCase().includes("dps")
            ? Number(p.amount)
            : undefined;
      players.push({
        name,
        className,
        specName,
        role,
        dps: Number.isFinite(dps as number) ? dps : undefined,
        serverSlug: asString(asRecord(p.server)?.slug) ?? asString(p.serverSlug),
        region: asString(asRecord(p.server)?.region),
      });
    }
    if (players.length) return players;
  }
  return [];
}

function parsePlayerDetails(raw: unknown): Map<string, RankingPlayer> {
  const map = new Map<string, RankingPlayer>();
  if (!raw || typeof raw !== "object") return map;

  const root = raw as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const groups = [data.dps, data.tanks, data.healers, data.players].filter(Boolean);

  const pushGroup = (group: unknown, defaultRole: string) => {
    if (!Array.isArray(group)) return;
    for (const item of group) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      const name = String(p.name ?? "");
      if (!name) continue;
      const specs = Array.isArray(p.specs) ? p.specs : [];
      const primarySpec = specs[0] as Record<string, unknown> | undefined;
      const className = String(p.type ?? p.class ?? p.className ?? "Unknown");
      const specName = String(primarySpec?.spec ?? p.spec ?? p.specName ?? "Unknown");
      map.set(name.toLowerCase(), {
        name,
        className,
        specName,
        role: String(p.role ?? defaultRole ?? guessRole(specName, className)),
        serverSlug: asString(p.server),
        region: asString(asRecord(p.server)?.region),
      });
    }
  };

  // WCL playerDetails shape: { data: { dps: [], tanks: [], healers: [] } }
  if (data.dps || data.tanks || data.healers) {
    pushGroup(data.dps, "DPS");
    pushGroup(data.tanks, "Tank");
    pushGroup(data.healers, "Healer");
  } else {
    for (const group of groups) pushGroup(group, "DPS");
  }

  return map;
}

function parseDamageTable(raw: unknown): Array<{
  name: string;
  dps: number;
  className?: string;
  specName?: string;
}> {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const entries = Array.isArray(data.entries)
    ? data.entries
    : Array.isArray(root.entries)
      ? root.entries
      : [];

  const totalTime = Number(data.totalTime ?? root.totalTime ?? 0);
  const rows: Array<{ name: string; dps: number; className?: string; specName?: string }> = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    // Skip pets / enemies; players usually have type "Player" or have icon/class.
    const type = String(e.type ?? "");
    if (type && !["Player", "player"].includes(type) && e.icon == null && e.class == null) {
      continue;
    }
    const name = String(e.name ?? "");
    if (!name) continue;

    let dps = e.dps != null ? Number(e.dps) : NaN;
    if (!Number.isFinite(dps)) {
      const total = Number(e.total ?? e.totalCombined ?? 0);
      dps = totalTime > 0 ? total / (totalTime / 1000) : total;
    }

    rows.push({
      name,
      dps: Number.isFinite(dps) ? dps : 0,
      className: asString(e.type) === "Player" ? asString(e.icon)?.split("-")[0] : asString(e.class),
      specName: asString(e.icon)?.split("-")[1],
    });
  }

  return rows;
}

export function guessRole(specName?: string, className?: string): string {
  const spec = (specName ?? "").toLowerCase();
  const cls = (className ?? "").toLowerCase();

  const tanks = new Set([
    "blood",
    "protection",
    "guardian",
    "brewmaster",
    "vengeance",
  ]);
  const healers = new Set([
    "holy",
    "discipline",
    "restoration",
    "mistweaver",
    "preservation",
  ]);

  // Protection / Holy paladin etc. covered by spec set.
  if (tanks.has(spec)) return "Tank";
  if (healers.has(spec)) return "Healer";
  if (cls === "evoker" && spec === "preservation") return "Healer";
  return "DPS";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
