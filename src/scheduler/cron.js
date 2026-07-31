import cron from "node-cron";
import { runGlobalCheck } from "../checkers/statusChecker.js";
import { logger } from "../utils/logger.js";
import bot from "../bot.js";

export const startScheduler = () => {
  // Run every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    logger.info("Cron Job triggered: Running global check");
    await runGlobalCheck(bot);
  });
  
  logger.info("Scheduler started. Running every 10 minutes.");
};
