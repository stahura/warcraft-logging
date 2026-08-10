import { SPEC_ALLOWLIST } from "../config/allowlist.js";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { enrichRankingRow } from "../services/enrichFight.js";
import { recomputeAggregates } from "../services/aggregates.js";
import {
  fetchCharacterRankings,
  fetchMythicPlusZones,
  fetchRateLimit,
  pickActiveSeasonZone,
  type RankingRow,
} from "../wcl/queries.js";

export type IngestTrigger = "cron" | "manual" | "startup";

type IngestResult = {
  jobId: string;
  status: "completed" | "failed";
  rankingsSeen: number;
  runsCreated: number;
  runsSkipped: number;
  errorCount: number;
  message?: string;
};

let running: Promise<IngestResult> | null = null;

export function isIngestRunning(): boolean {
  return running != null;
}

export async function startIngest(trigger: IngestTrigger, limit = env.INGEST_LIMIT): Promise<IngestResult> {
  if (running) {
    throw new Error("An ingest job is already running");
  }

  running = runIngest(trigger, limit).finally(() => {
    running = null;
  });

  return running;
}

async function runIngest(trigger: IngestTrigger, limit: number): Promise<IngestResult> {
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

  try {
    const rate = await fetchRateLimit();
    if (rate && rate.pointsSpentThisHour / rate.limitPerHour > 0.9) {
      throw new Error(
        `WCL rate limit nearly exhausted (${rate.pointsSpentThisHour}/${rate.limitPerHour}). Reset in ${rate.pointsResetIn}s.`,
      );
    }

    const zones = await fetchMythicPlusZones();
    if (zones.length === 0) {
      throw new Error("No Mythic+ zones found via worldData.zones");
    }

    const zone = pickActiveSeasonZone(zones);
    const season = await prisma.season.upsert({
      where: { zoneId: zone.id },
      create: {
        zoneId: zone.id,
        name: zone.name,
        active: !zone.frozen,
      },
      update: {
        name: zone.name,
        active: !zone.frozen,
      },
    });

    // Mark other seasons inactive when we lock onto a newer one.
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

    for (const target of SPEC_ALLOWLIST) {
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

        // Clear and rewrite current leaderboard slots for this dungeon/spec.
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
              // Keep key/score fresh from latest leaderboard snapshot.
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
    }

    const status = errorCount > 0 && runsCreated + runsSkipped === 0 ? "failed" : "completed";
    const message =
      status === "failed"
        ? errors[0]?.message ?? "Ingest failed"
        : `Ingested zone ${zone.name} (${zone.id}) for ${SPEC_ALLOWLIST.length} spec(s)`;

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
        detailsJson: { zoneId: zone.id, zoneName: zone.name, errors: errors.slice(0, 50) },
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
