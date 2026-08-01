import prisma from "../database/client.js";
import { detectPlatform, checkLinkStatus } from "../checkers/statusChecker.js";
import { getStatusEmoji } from "../utils/formatters.js";
import { logger } from "../utils/logger.js";

const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

const handleAddLink = async (ctx, text) => {
  if (!isValidUrl(text)) {
    return ctx.reply("❌ Invalid URL format. Please send a valid web address.");
  }

  const url = text;
  const platform = detectPlatform(url);
  if (!platform) {
    return ctx.reply("⚠️ Unsupported platform. I currently support:\n• Facebook\n• Instagram\n• TikTok\n• YouTube");
  }

  try {
    const existingLink = await prisma.link.findFirst({
      where: { userId: ctx.dbUser.id, url: url },
    });

    if (existingLink) {
      return ctx.reply("✅ You are already monitoring this link!");
    }

    const waitMsg = await ctx.reply("🔍 Analyzing URL... please wait.");
    const { status: currentStatus, name, photoUrl } = await checkLinkStatus(platform, url);

    await prisma.link.create({
      data: {
        userId: ctx.dbUser.id,
        platform,
        url,
        name,
        photoUrl,
        currentStatus,
        lastChecked: new Date(),
      },
    });

    let caption = `🎉 *Link Added Successfully!*\n\n*Platform:* ${platform}`;
    if (name) caption += `\n*Name:* ${name}`;
    caption += `\n*URL:* ${url}`;

    const replyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: getStatusEmoji(currentStatus), callback_data: "status_btn_ignore" }]
        ]
      }
    };

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
    } catch (e) {} // Ignore if we can't delete the waiting message

    if (photoUrl) {
      try {
        await ctx.replyWithPhoto(photoUrl, { caption, parse_mode: "Markdown", ...replyMarkup });
      } catch (photoError) {
        logger.error(`Failed to send photo: ${photoError.message}`);
        await ctx.reply(caption, { parse_mode: "Markdown", disable_web_page_preview: true, ...replyMarkup });
      }
    } else {
      await ctx.reply(caption, { parse_mode: "Markdown", disable_web_page_preview: true, ...replyMarkup });
    }
  } catch (error) {
    logger.error(`Error in add link: ${error.message}`);
    await ctx.reply("❌ An error occurred while adding the link. Please try again later.");
  }
};

export const setupCommands = (bot) => {
  bot.command("start", (ctx) => {
    ctx.reply(
      "🌟 *Welcome to Ads Social Checker!* 🌟\n\n" +
        "I am your personal automated monitor. I keep an eye on social media profiles and instantly alert you the moment they go down or change.\n\n" +
        "📊 *Supported Platforms:*\n" +
        "• Facebook\n• Instagram\n• TikTok\n• YouTube\n\n" +
        "💡 *How to use:*\n" +
        "Simply paste a profile link directly into this chat to start monitoring it, or use `/help` to see all commands.",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("help", (ctx) => {
    ctx.reply(
      "🛠️ *Available Commands:*\n\n" +
        "🔹 /add `<url>` - Monitor a new link\n" +
        "🔹 /remove `<url>` - Stop monitoring a link\n" +
        "🔹 /list - View all your tracked links\n" +
        "🔹 /status - Check the live status of your links\n" +
        "🔹 /history `<url>` - View the status history of a link\n" +
        "🔹 /check `<url>` - Force a manual status check right now\n\n" +
        "*(You can also just paste a URL directly without typing /add!)*",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("add", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("⚠️ Please provide a URL. Usage: `/add <url>`", { parse_mode: "Markdown" });
    }
    await handleAddLink(ctx, parts[1]);
  });

  bot.command("remove", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("⚠️ Please provide a URL. Usage: `/remove <url>`", { parse_mode: "Markdown" });
    }

    const url = parts[1];
    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (!link) {
        return ctx.reply("❌ Link not found in your tracking list.");
      }

      await prisma.link.delete({
        where: { id: link.id },
      });

      ctx.reply("🗑️ *Link removed successfully.*", { parse_mode: "Markdown" });
    } catch (error) {
      logger.error(`Error in /remove: ${error.message}`);
      ctx.reply("❌ An error occurred while removing the link.");
    }
  });

  bot.command("list", async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("📭 You are not tracking any links yet. Paste a link to get started!");
      }

      let message = "📋 *Your Monitored Links:*\n\n";
      links.forEach((link, idx) => {
        message += `*${idx + 1}.* [${link.platform}] ${link.url}\n`;
      });

      ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /list: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching your links.");
    }
  });

  bot.command("status", async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("📭 You are not tracking any links yet.");
      }

      let message = "📊 *Live Status Report:*\n\n";
      links.forEach((link, idx) => {
        const emoji = getStatusEmoji(link.currentStatus);
        const namePart = link.name ? ` (${link.name})` : "";
        message += `*${idx + 1}. ${link.platform}*${namePart}\n`;
        message += `${emoji}\n`;
        message += `🔗 [Link](${link.url})\n\n`;
      });

      ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /status: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching statuses.");
    }
  });

  bot.command("check", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("⚠️ Please provide a URL. Usage: `/check <url>`", { parse_mode: "Markdown" });
    }

    const url = parts[1];
    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (!link) {
        return ctx.reply("❌ Link not found in your tracking list. Please add it first.");
      }

      const waitMsg = await ctx.reply("🔍 Running manual check...");
      const { status: newStatus, name: newName, photoUrl: newPhotoUrl } = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      let statusChanged = newStatus !== link.currentStatus && newStatus !== "UNKNOWN";
      let nameChanged = newName && newName !== link.name;
      let photoChanged = newPhotoUrl && newPhotoUrl !== link.photoUrl;

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
      } catch (e) {}

      if (statusChanged || nameChanged || photoChanged) {
        if (statusChanged) {
          await prisma.history.create({
            data: { linkId: link.id, status: newStatus },
          });
        }

        await prisma.link.update({
          where: { id: link.id },
          data: {
            ...(statusChanged && { lastStatus: link.currentStatus, currentStatus: newStatus, lastChanged: now }),
            ...(nameChanged && { name: newName }),
            ...(photoChanged && { photoUrl: newPhotoUrl }),
            lastChecked: now,
          },
        });

        let message = `🚨 *Update Detected (Manual Check)*\n\n*Platform:* ${link.platform}\n*URL:* ${link.url}\n`;
        if (statusChanged) message += `*Old Status:* ${getStatusEmoji(link.currentStatus)}\n*New Status:* ${getStatusEmoji(newStatus)}\n`;
        if (nameChanged) message += `*New Name:* ${newName}\n`;
        if (photoChanged) message += `*New Photo Detected!* 📸\n`;

        if (photoChanged && newPhotoUrl) {
          try {
            await ctx.replyWithPhoto(newPhotoUrl, { caption: message, parse_mode: "Markdown" });
          } catch (photoError) {
            logger.error(`Failed to send photo: ${photoError.message}`);
            await ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
          }
        } else {
          await ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
        }
      } else {
        await prisma.link.update({
          where: { id: link.id },
          data: { lastChecked: now },
        });
        
        let msg = `✅ *Status Unchanged*\n\n${getStatusEmoji(newStatus)}`;
        if (link.name) msg += `\n*Name:* ${link.name}`;
        await ctx.reply(msg, { parse_mode: "Markdown" });
      }
    } catch (error) {
      logger.error(`Error in /check: ${error.message}`);
      ctx.reply("❌ An error occurred during manual check.");
    }
  });

  bot.command("history", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("⚠️ Please provide a URL. Usage: `/history <url>`", { parse_mode: "Markdown" });
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
        return ctx.reply("❌ Link not found in your tracking list.");
      }

      if (link.histories.length === 0) {
        return ctx.reply("📭 No history available for this link yet.");
      }

      let message = `🕒 *History for:*\n[${link.platform}] ${link.url}\n\n`;
      link.histories.forEach((h) => {
        message += `• ${getStatusEmoji(h.status)} - ${h.checkedAt.toISOString().replace('T', ' ').substring(0, 16)}\n`;
      });

      ctx.reply(message, { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /history: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching history.");
    }
  });

  // Catch-all for plain text messages
  bot.on("message", async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/")) {
      return next();
    }
    if (!ctx.message || !ctx.message.text) return next();

    const text = ctx.message.text.trim();
    if (isValidUrl(text)) {
      await handleAddLink(ctx, text);
    }
    // Ignore non-URL text completely, preventing spam messages if user types random chat
  });
};
