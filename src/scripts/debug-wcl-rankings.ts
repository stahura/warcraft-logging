/**
 * DB-free probe: auth + zone pick + one (or all) encounter ranking fetches.
 * Usage: WCL_DEBUG=1 npx tsx src/scripts/debug-wcl-rankings.ts [encounterId]
 */
import { SPEC_ALLOWLIST } from "../config/allowlist.js";
import {
  fetchCharacterRankings,
  fetchMythicPlusZones,
  fetchRateLimit,
  pickActiveSeasonZone,
} from "../wcl/queries.js";

process.env.WCL_DEBUG ??= "1";

const encounterFilter = process.argv[2] ? Number(process.argv[2]) : null;

const rate = await fetchRateLimit();
console.log("[debug] rateLimit", rate);

const zones = await fetchMythicPlusZones();
console.log(
  "[debug] mythicPlusZones",
  zones.map((z) => ({ id: z.id, name: z.name, frozen: z.frozen, encounters: z.encounters.length })),
);

const zone = pickActiveSeasonZone(zones);
console.log("[debug] pickedZone", {
  id: zone.id,
  name: zone.name,
  frozen: zone.frozen,
  encounters: zone.encounters.map((e) => ({ id: e.id, name: e.name })),
});

const target = SPEC_ALLOWLIST[0]!;
const encounters = encounterFilter
  ? zone.encounters.filter((e) => e.id === encounterFilter)
  : zone.encounters;

if (encounters.length === 0) {
  console.error("[debug] no encounters to probe", { encounterFilter });
  process.exit(1);
}

let total = 0;
for (const encounter of encounters) {
  const rankings = await fetchCharacterRankings({
    encounterId: encounter.id,
    className: target.className,
    specName: target.specName,
    page: 1,
    includeOtherPlayers: true,
  });
  total += rankings.length;
  console.log("[debug] parsed", {
    encounterId: encounter.id,
    name: encounter.name,
    count: rankings.length,
    top: rankings.slice(0, 3).map((r) => ({
      name: r.name,
      score: r.score,
      keyLevel: r.keyLevel,
      reportCode: r.reportCode,
      fightId: r.fightId,
    })),
  });
}

console.log("[debug] done", { encountersProbed: encounters.length, totalParsedRankings: total });
