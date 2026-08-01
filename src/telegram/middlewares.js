import prisma from "../database/client.js";
import { logger } from "../utils/logger.js";

import bot from "../bot.js";
import { updateUserMenu } from "./menu.js";

// Rate limiting map (in-memory, simplified)
const userRequests = new Map();

export const rateLimit = (ctx, next) => {
  const userId = ctx.from.id;
  const now = Date.now();
  const limitWindow = 1000; // 1 request per second

  if (userRequests.has(userId)) {
    const lastRequest = userRequests.get(userId);
    if (now - lastRequest < limitWindow) {
      return ctx.reply("Please slow down. You are sending requests too fast.");
    }
  }

  userRequests.set(userId, now);
  return next();
};

export const registerUser = async (ctx, next) => {
  if (!ctx.from) return next();

  const { id, username, first_name, last_name } = ctx.from;

  try {
    let user = await prisma.user.findUnique({
      where: { telegramId: id.toString() },
    });

    if (user && user.role !== "SUPER_ADMIN" && user.id === 1) {
      // Upgrade the first legacy user to SUPER_ADMIN
      user = await prisma.user.update({
        where: { id: user.id },
        data: { 
          role: "SUPER_ADMIN",
          licenseExpiresAt: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000)
        }
      });
      await updateUserMenu(bot, id, "SUPER_ADMIN");
      logger.info(`Upgraded legacy user ${id} to SUPER_ADMIN`);
    }

    if (!user) {
      const userCount = await prisma.user.count();
      const role = userCount === 0 ? "SUPER_ADMIN" : "USER";
      // First user gets admin, plus a 10-year license by default
      const licenseExpiresAt = userCount === 0 ? new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000) : null;
      
      user = await prisma.user.create({
        data: {
          telegramId: id.toString(),
          username: username || null,
          firstName: first_name || null,
          lastName: last_name || null,
          role,
          licenseExpiresAt,
          settings: {
            create: {}, // Create default settings
          },
        },
      });
      await updateUserMenu(bot, id, role);
      logger.info(`New user registered: ${id} with role ${role}`);
    }
    
    // Inject user into context for downstream commands
    ctx.dbUser = user;
    return next();
  } catch (error) {
    logger.error(`Error registering user: ${error.message}`);
    return ctx.reply("An error occurred while processing your user profile.");
  }
};

export const licenseGate = async (ctx, next) => {
  if (!ctx.dbUser) return next();
  
  // Allow ADMIN and SUPER_ADMIN to always bypass
  if (ctx.dbUser.role === "ADMIN" || ctx.dbUser.role === "SUPER_ADMIN") return next();

  // If message text might be a license key redemption, let it pass to commands.js
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith("AGENCY-")) {
    return next();
  }
  
  // If license is expired or null
  const now = new Date();
  if (!ctx.dbUser.licenseExpiresAt || ctx.dbUser.licenseExpiresAt < now) {
    // If it's a callback query (button click), answer it so it doesn't spin forever
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery("🔒 Your license has expired.", { show_alert: true });
    }
    
    // Dynamically fetch support contacts for the paywall
    let supportButtons = [];
    try {
      const contacts = await prisma.supportContact.findMany({ orderBy: { id: 'asc' } });
      supportButtons = contacts.map(c => [{ text: c.name, url: c.url }]);
    } catch (e) {
      // Ignore DB errors
    }

    // Fallback if the database is empty
    if (supportButtons.length === 0) {
      supportButtons = [[{ text: "🛒 Contact Support to Buy Key", url: "https://t.me/adssupportz" }]];
    }
    
    // Dynamically fetch paywall text
    let paywallMessage = `🔒 <b>Your license has expired.</b>\n\nPlease enter a valid License Key to continue using the bot. (e.g. AGENCY-XYZ123)\n\n💬 <b>Need a key?</b> Contact our support team below to purchase access.`;
    try {
      const config = await prisma.systemConfig.findUnique({ where: { key: "PAYWALL_MESSAGE" } });
      if (config) paywallMessage = config.value;
    } catch (e) {
      // Ignore DB errors
    }
    
    return ctx.reply(paywallMessage, { 
        parse_mode: "HTML", 
        reply_markup: {
          inline_keyboard: supportButtons
        }
      }
    );
  }

  return next();
};
