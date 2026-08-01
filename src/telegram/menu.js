import { logger } from "../utils/logger.js";

const baseCommands = [
  { command: "status", description: "View the live status of your links" },
  { command: "linkgroup", description: "Link a Telegram Group to your alerts" },
  { command: "unlinkgroup", description: "Unlink your Telegram Group" },
  { command: "help", description: "Show instructions" },
];

export const setGlobalCommands = async (bot) => {
  try {
    await bot.telegram.setMyCommands(baseCommands);
    logger.info("Global default commands set.");
  } catch (error) {
    logger.error(`Failed to set global commands: ${error.message}`);
  }
};

export const updateUserMenu = async (bot, telegramId, role) => {
  try {
    const adminCommands = [
      ...baseCommands,
      { command: "genkey", description: "[ADMIN] Generate a license key" },
      { command: "broadcast", description: "[ADMIN] Broadcast a message to all users" },
    ];

    const superAdminCommands = [
      ...adminCommands,
      { command: "users", description: "[SUPER_ADMIN] View database users" },
      { command: "promote", description: "[SUPER_ADMIN] Promote a user to ADMIN" },
      { command: "demote", description: "[SUPER_ADMIN] Demote an ADMIN to USER" },
    ];

    let commandsToSet = baseCommands;
    if (role === "ADMIN") commandsToSet = adminCommands;
    else if (role === "SUPER_ADMIN") commandsToSet = superAdminCommands;

    await bot.telegram.setMyCommands(commandsToSet, {
      scope: { type: "chat", chat_id: telegramId }
    });
    
    logger.info(`Updated Telegram menu for user ${telegramId} with role ${role}`);
  } catch (error) {
    logger.error(`Failed to update Telegram menu for ${telegramId}: ${error.message}`);
  }
};
