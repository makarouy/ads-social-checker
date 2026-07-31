import prisma from "../database/client.js";
import { detectPlatform, checkLinkStatus } from "../checkers/statusChecker.js";
import { logger } from "../utils/logger.js";

const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

export const setupCommands = (bot) => {
  bot.command("start", (ctx) => {
    ctx.reply(
      "Welcome to Ads Social Checker! 🚀\n\n" +
        "I can monitor Facebook, Instagram, TikTok, and YouTube URLs and notify you when their status changes.\n\n" +
        "Use /help to see all available commands."
    );
  });

  bot.command("help", (ctx) => {
    ctx.reply(
      "Available commands:\n" +
        "/start - Start the bot\n" +
        "/help - Show this help message\n" +
        "/add <url> - Add a new link to monitor\n" +
        "/remove <url> - Remove a monitored link\n" +
        "/list - List all your monitored links\n" +
        "/check <url> - Manually check a specific link now\n" +
        "/status - Show status of all your links\n" +
        "/history <url> - Show history of a link"
    );
  });

  bot.command("add", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("Please provide a URL. Usage: /add <url>");
    }

    const url = parts[1];
    if (!isValidUrl(url)) {
      return ctx.reply("Invalid URL format.");
    }

    const platform = detectPlatform(url);
    if (!platform) {
      return ctx.reply("Unsupported platform. Supported: Facebook, Instagram, TikTok, YouTube.");
    }

    try {
      const existingLink = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (existingLink) {
        return ctx.reply("You are already tracking this link.");
      }

      ctx.reply("Checking URL status before adding...");
      const currentStatus = await checkLinkStatus(platform, url);

      await prisma.link.create({
        data: {
          userId: ctx.dbUser.id,
          platform,
          url,
          currentStatus,
          lastChecked: new Date(),
        },
      });

      ctx.reply(`Link added successfully.\nPlatform: ${platform}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `Current Status: ${currentStatus}`, callback_data: "status_btn_ignore" }]
          ]
        }
      });
    } catch (error) {
      logger.error(`Error in /add: ${error.message}`);
      ctx.reply("An error occurred while adding the link.");
    }
  });

  bot.command("remove", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("Please provide a URL. Usage: /remove <url>");
    }

    const url = parts[1];

    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (!link) {
        return ctx.reply("Link not found in your tracking list.");
      }

      await prisma.link.delete({
        where: { id: link.id },
      });

      ctx.reply("Link removed successfully.");
    } catch (error) {
      logger.error(`Error in /remove: ${error.message}`);
      ctx.reply("An error occurred while removing the link.");
    }
  });

  bot.command("list", async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("You are not tracking any links yet.");
      }

      let message = "📋 *Your Monitored Links:*\n\n";
      links.forEach((link, idx) => {
        message += `${idx + 1}. [${link.platform}] ${link.url}\n`;
      });

      ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /list: ${error.message}`);
      ctx.reply("An error occurred while fetching your links.");
    }
  });

  bot.command("status", async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("You are not tracking any links yet.");
      }

      let message = "📊 *Status of Monitored Links:*\n\n";
      links.forEach((link, idx) => {
        message += `${idx + 1}. *${link.platform}* - ${link.currentStatus}\n${link.url}\n\n`;
      });

      ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /status: ${error.message}`);
      ctx.reply("An error occurred while fetching statuses.");
    }
  });

  bot.command("check", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("Please provide a URL. Usage: /check <url>");
    }

    const url = parts[1];

    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (!link) {
        return ctx.reply("Link not found in your tracking list. Please add it first.");
      }

      ctx.reply("Checking now...");
      const newStatus = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      if (newStatus !== link.currentStatus && newStatus !== "UNKNOWN") {
        await prisma.history.create({
          data: { linkId: link.id, status: newStatus },
        });

        await prisma.link.update({
          where: { id: link.id },
          data: {
            lastStatus: link.currentStatus,
            currentStatus: newStatus,
            lastChecked: now,
            lastChanged: now,
          },
        });

        ctx.reply(
          `🚨 *Status Changed*\n\n*Platform:* ${link.platform}\n*Old Status:* ${link.currentStatus}\n*New Status:* ${newStatus}\n*URL:* ${link.url}`,
          { parse_mode: "Markdown", disable_web_page_preview: true }
        );
      } else {
        await prisma.link.update({
          where: { id: link.id },
          data: { lastChecked: now },
        });
        ctx.reply(`Status unchanged: ${newStatus}`);
      }
    } catch (error) {
      logger.error(`Error in /check: ${error.message}`);
      ctx.reply("An error occurred during manual check.");
    }
  });

  bot.command("history", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("Please provide a URL. Usage: /history <url>");
    }

    const url = parts[1];

    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
        include: {
          histories: {
            orderBy: { checkedAt: 'desc' },
            take: 10
          }
        }
      });

      if (!link) {
        return ctx.reply("Link not found in your tracking list.");
      }

      if (link.histories.length === 0) {
        return ctx.reply("No history available for this link yet.");
      }

      let message = `🕒 *History for:*\n${link.url}\n\n`;
      link.histories.forEach((h) => {
        message += `- ${h.status} at ${h.checkedAt.toISOString().replace('T', ' ').substring(0, 16)}\n`;
      });

      ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /history: ${error.message}`);
      ctx.reply("An error occurred while fetching history.");
    }
  });
};
