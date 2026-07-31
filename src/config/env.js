import dotenv from "dotenv";
import { cleanEnv, str, port, num } from "envalid"; // We could use envalid or just basic checks, I'll use basic for no extra deps or just simple throws.

dotenv.config();

const requiredEnvs = ["BOT_TOKEN", "DATABASE_URL"];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  botToken: process.env.BOT_TOKEN,
  databaseUrl: process.env.DATABASE_URL,
  adminIds: process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(",").map((id) => id.trim())
    : [],
};
