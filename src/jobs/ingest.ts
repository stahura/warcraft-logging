import { SPEC_ALLOWLIST, type SpecTarget } from "../config/allowlist.js";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { enrichRankingRow } from "../services/enrichFight.js";
import { recomputeAggregates } from "../services/aggregates.js";
import {
  fetchCharacterRankings,
  fetchMythicPlusZones,
  fetchRateLimit,
  fetchZoneById,
  pickActiveSeasonZone,
  type RankingRow,
} from "../wcl/queries.js";
import { advanceCursor, claimNextSpecs } from "./cursor.js";

export type IngestTrigger = "cron" | "manual" | "startup";

export type IngestResult = {
  jobId: string;
  status: "completed" | "failed" | "partial";
  rankingsSeen: number;
  runsCreated: number;
  runsSkipped: number;
  errorCount: number;
  message?: string;
  specs?: string[];
};

let running: Promise<IngestResult> | null = null;

export function isIngestRunning(): boolean {
  return running != null;
}

export async function startIngest(
  trigger: IngestTrigger,
  limit = env.INGEST_LIMIT,
  options?: { allSpecs?: boolean; specCount?: number },
): Promise<IngestResult> {
  if (running) {
    throw new Error("An ingest job is already running");
  }

  running = runIngest(trigger, limit, options).finally(() => {
    running = null;
  });

  return running;
}

async function resolveZone() {
  if (env.WCL_ZONE_ID) {
    const zone = await fetchZoneById(env.WCL_ZONE_ID);
    if (!zone) {
      throw new Error(`WCL zone ${env.WCL_ZONE_ID} not found`);
    }
    return zone;
  }

  const zones = await fetchMythicPlusZones();
  if (zones.length === 0) {
    throw new Error("No Mythic+ zones found via worldData.zones");
  }
  return pickActiveSeasonZone(zones);
}

async function rateLimitTooHigh(): Promise<{ blocked: boolean; detail?: string }> {
  const rate = await fetchRateLimit();
  if (!rate) return { blocked: false };
  const ratio = rate.pointsSpentThisHour / rate.limitPerHour;
  if (ratio > env.WCL_RATE_LIMIT_MAX_RATIO) {
    return {
      blocked: true,
      detail: `WCL rate limit ${rate.pointsSpentThisHour.toFixed(1)}/${rate.limitPerHour} (reset in ${rate.pointsResetIn}s)`,
    };
  }
  return { blocked: false, detail: `${rate.pointsSpentThisHour.toFixed(1)}/${rate.limitPerHour}` };
}

async function runIngest(
  trigger: IngestTrigger,
  limit: number,
  options?: { allSpecs?: boolean; specCount?: number },
): Promise<IngestResult> {
  const job = await prisma.ingestJob.create({
    data: {
      trigger,
      status: "running",
      limit,
    },
  });

  let rankingsSeen = 0;
  let runsCreated = 0;
  let runsSkipped = 0;
  let errorCount = 0;
  const errors: Array<{ context: string; message: string }> = [];
  const completedSpecs: SpecTarget[] = [];

  try {
    const initialRate = await rateLimitTooHigh();
    if (initialRate.blocked) {
      throw new Error(initialRate.detail ?? "WCL rate limit nearly exhausted");
    }

    const zone = await resolveZone();
    const season = await prisma.season.upsert({
      where: { zoneId: zone.id },
      create: {
        zoneId: zone.id,
        name: zone.name,
        active: true,
      },
      update: {
        name: zone.name,
        active: true,
      },
    });

    // Only one active season at a time (PTR S2 while configured).
    await prisma.season.updateMany({
      where: { id: { not: season.id } },
      data: { active: false },
    });

    for (const encounter of zone.encounters) {
      await prisma.dungeon.upsert({
        where: {
          seasonId_encounterId: {
            seasonId: season.id,
            encounterId: encounter.id,
          },
        },
        create: {
          seasonId: season.id,
          encounterId: encounter.id,
          name: encounter.name,
        },
        update: {
          name: encounter.name,
        },
      });
    }

    const dungeons = await prisma.dungeon.findMany({ where: { seasonId: season.id } });

    let targets: SpecTarget[];
    let nextIndex: number | null = null;
    let startIndex = 0;

    if (options?.allSpecs) {
      targets = [...SPEC_ALLOWLIST];
    } else {
      const claimed = await claimNextSpecs(options?.specCount ?? env.INGEST_SPECS_PER_TICK);
      targets = claimed.specs;
      nextIndex = claimed.nextIndex;
      startIndex = claimed.startIndex;
    }

    if (targets.length === 0) {
      throw new Error("No specs in allowlist");
    }

    console.log(
      `[ingest] zone=${zone.name} (${zone.id}) specs=${targets.map((t) => `${t.className}/${t.specName}`).join(", ")} rate=${initialRate.detail ?? "?"}`,
    );

    for (const target of targets) {
      const rate = await rateLimitTooHigh();
      if (rate.blocked) {
        errors.push({
          context: "rate-limit",
          message: `Stopped before ${target.className}/${target.specName}: ${rate.detail}`,
        });
        break;
      }

      for (const dungeon of dungeons) {
        let rankings: RankingRow[] = [];
        try {
          rankings = await fetchCharacterRankings({
            encounterId: dungeon.encounterId,
            className: target.className,
            specName: target.specName,
            page: 1,
            includeOtherPlayers: true,
          });
        } catch (err) {
          errorCount += 1;
          errors.push({
            context: `rankings ${target.className}/${target.specName} @ ${dungeon.name}`,
            message: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        const top = rankings.slice(0, limit);
        rankingsSeen += top.length;
        console.log(
          `[ingest] ${target.className}/${target.specName} @ ${dungeon.name} (${dungeon.encounterId}): ${rankings.length} rankings, keeping ${top.length}`,
        );

        await prisma.leaderboardSlot.deleteMany({
          where: {
            seasonId: season.id,
            dungeonId: dungeon.id,
            className: target.className,
            specName: target.specName,
          },
        });

        let rank = 0;
        for (const row of top) {
          rank += 1;
          try {
            const existing = await prisma.run.findUnique({
              where: {
                reportCode_fightId: {
                  reportCode: row.reportCode,
                  fightId: row.fightId,
                },
              },
              include: { players: true },
            });

            let runId: string;

            if (existing && existing.players.some((p) => p.isTarget && p.dps != null)) {
              runsSkipped += 1;
              runId = existing.id;
              await prisma.run.update({
                where: { id: existing.id },
                data: {
                  keyLevel: row.keyLevel || existing.keyLevel,
                  score: row.score,
                  durationMs: row.durationMs ?? existing.durationMs,
                },
              });
            } else {
              const enriched = await enrichRankingRow(row);
              const run = await prisma.run.upsert({
                where: {
                  reportCode_fightId: {
                    reportCode: enriched.reportCode,
                    fightId: enriched.fightId,
                  },
                },
                create: {
                  reportCode: enriched.reportCode,
                  fightId: enriched.fightId,
                  dungeonId: dungeon.id,
                  keyLevel: enriched.keyLevel,
                  score: enriched.score,
                  durationMs: enriched.durationMs,
                  startTime: enriched.startTime,
                  players: {
                    create: enriched.players.map((p) => ({
                      name: p.name,
                      className: p.className,
                      specName: p.specName,
                      role: p.role,
                      dps: p.dps,
                      isTarget: p.name.toLowerCase() === enriched.targetName.toLowerCase(),
                      serverSlug: p.serverSlug,
                      region: p.region,
                    })),
                  },
                },
                update: {
                  keyLevel: enriched.keyLevel,
                  score: enriched.score,
                  durationMs: enriched.durationMs,
                  startTime: enriched.startTime,
                  players: {
                    deleteMany: {},
                    create: enriched.players.map((p) => ({
                      name: p.name,
                      className: p.className,
                      specName: p.specName,
                      role: p.role,
                      dps: p.dps,
                      isTarget: p.name.toLowerCase() === enriched.targetName.toLowerCase(),
                      serverSlug: p.serverSlug,
                      region: p.region,
                    })),
                  },
                },
              });
              runId = run.id;
              runsCreated += 1;
            }

            await prisma.leaderboardSlot.create({
              data: {
                seasonId: season.id,
                dungeonId: dungeon.id,
                className: target.className,
                specName: target.specName,
                rank,
                runId,
                score: row.score,
              },
            });
          } catch (err) {
            errorCount += 1;
            errors.push({
              context: `enrich ${row.reportCode}#${row.fightId}`,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }

        await recomputeAggregates({
          seasonId: season.id,
          dungeonId: dungeon.id,
          className: target.className,
          specName: target.specName,
        });
      }

      completedSpecs.push(target);
    }

    if (nextIndex != null && completedSpecs.length > 0) {
      // Advance only past specs that finished; if we stopped early, resume there next hour.
      const advanced = (startIndex + completedSpecs.length) % SPEC_ALLOWLIST.length;
      await advanceCursor(advanced, zone.id);
      nextIndex = advanced;
    }

    const stoppedEarly = completedSpecs.length < targets.length;
    const status =
      errorCount > 0 && runsCreated + runsSkipped === 0
        ? "failed"
        : stoppedEarly
          ? "partial"
          : "completed";

    const specLabels = completedSpecs.map((s) => `${s.className}/${s.specName}`);
    const message =
      status === "failed"
        ? errors[0]?.message ?? "Ingest failed"
        : `Ingested ${zone.name} (${zone.id}) for ${completedSpecs.length}/${targets.length} spec(s): ${specLabels.join(", ")}`;

    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status,
        finishedAt: new Date(),
        rankingsSeen,
        runsCreated,
        runsSkipped,
        errorCount,
        message,
        detailsJson: {
          zoneId: zone.id,
          zoneName: zone.name,
          requestedSpecs: targets.map((s) => `${s.className}/${s.specName}`),
          completedSpecs: specLabels,
          nextIndex,
          errors: errors.slice(0, 50),
        },
      },
    });

    return {
      jobId: job.id,
      status,
      rankingsSeen,
      runsCreated,
      runsSkipped,
      errorCount,
      message,
      specs: specLabels,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        rankingsSeen,
        runsCreated,
        runsSkipped,
        errorCount: errorCount + 1,
        message,
        detailsJson: { errors: [...errors, { context: "fatal", message }].slice(0, 50) },
      },
    });

    return {
      jobId: job.id,
      status: "failed",
      rankingsSeen,
      runsCreated,
      runsSkipped,
      errorCount: errorCount + 1,
      message,
    };
  }
}
