import { Telegraf } from "telegraf";
import { config } from "./config/env.js";
import { rateLimit, registerUser, licenseGate } from "./telegram/middlewares.js";
import { setupCommands } from "./telegram/commands.js";
import { setGlobalCommands } from "./telegram/menu.js";
import { logger } from "./utils/logger.js";

const bot = new Telegraf(config.botToken);

bot.use(rateLimit);
bot.use(registerUser);
bot.use(licenseGate);

setupCommands(bot);
setGlobalCommands(bot);

bot.catch((err, ctx) => {
  logger.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

export default bot;
