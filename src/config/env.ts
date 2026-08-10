import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/warcraft_logging"),
  WCL_CLIENT_ID: z.string().optional(),
  WCL_CLIENT_SECRET: z.string().optional(),
  REFRESH_TOKEN: z.string().default("dev-refresh-token"),
  INGEST_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  INGEST_CRON_HOURS: z.coerce.number().positive().default(48),
  WCL_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = envSchema.parse(process.env);

export function requireWclCredentials(): { clientId: string; clientSecret: string } {
  if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
    throw new Error(
      "Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET. Create a free API client at https://www.warcraftlogs.com/api/clients and set both env vars.",
    );
  }
  return { clientId: env.WCL_CLIENT_ID, clientSecret: env.WCL_CLIENT_SECRET };
}
