import app from "./app.js";
import bot from "./bot.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import prisma from "./database/client.js";
import { startScheduler } from "./scheduler/cron.js";

const startServer = async () => {
  try {
    // Database connection test
    await prisma.$connect();
    logger.info("Connected to the database successfully.");

    // Start Express API
    app.listen(config.port, () => {
      logger.info(`Express API running on port ${config.port}`);
    });

    // Start Telegram Bot
    bot.launch(() => {
      logger.info("Telegram Bot started successfully.");
    });

    // Start Cron Scheduler
    startScheduler();

    // Enable graceful stop
    process.once("SIGINT", async () => {
      bot.stop("SIGINT");
      await prisma.$disconnect();
      process.exit(0);
    });
    process.once("SIGTERM", async () => {
      bot.stop("SIGTERM");
      await prisma.$disconnect();
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
