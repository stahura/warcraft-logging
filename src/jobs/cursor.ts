import { SPEC_ALLOWLIST, type SpecTarget } from "../config/allowlist.js";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";

export async function claimNextSpecs(count = env.INGEST_SPECS_PER_TICK): Promise<{
  specs: SpecTarget[];
  startIndex: number;
  nextIndex: number;
}> {
  const total = SPEC_ALLOWLIST.length;
  if (total === 0) {
    return { specs: [], startIndex: 0, nextIndex: 0 };
  }

  const take = Math.min(count, total);
  const cursor = await prisma.ingestCursor.upsert({
    where: { id: "default" },
    create: { id: "default", zoneId: env.WCL_ZONE_ID, nextIndex: 0 },
    update: { zoneId: env.WCL_ZONE_ID },
  });

  const startIndex = ((cursor.nextIndex % total) + total) % total;
  const specs: SpecTarget[] = [];
  for (let i = 0; i < take; i += 1) {
    specs.push(SPEC_ALLOWLIST[(startIndex + i) % total]!);
  }

  return {
    specs,
    startIndex,
    nextIndex: (startIndex + take) % total,
  };
}

export async function advanceCursor(nextIndex: number, zoneId = env.WCL_ZONE_ID): Promise<void> {
  await prisma.ingestCursor.upsert({
    where: { id: "default" },
    create: { id: "default", zoneId, nextIndex },
    update: { zoneId, nextIndex },
  });
}
