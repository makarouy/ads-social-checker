import cron from "node-cron";
import { runGlobalCheck } from "../checkers/statusChecker.js";
import { runWeeklySummary } from "./weeklySummary.js";
import { logger } from "../utils/logger.js";
import bot from "../bot.js";

export const startScheduler = () => {
  // Run every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    logger.info("Cron Job triggered: Running global check");
    await runGlobalCheck(bot);
  });
  
  // Run Weekly Summary on Fridays at 17:00 (5:00 PM)
  cron.schedule("0 17 * * 5", async () => {
    logger.info("Cron Job triggered: Running Weekly Summary");
    await runWeeklySummary(bot);
  });
  
  logger.info("Scheduler started. Global check every 10m, Weekly Summary Fridays at 17:00.");
};
