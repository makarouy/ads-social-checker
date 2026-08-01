import prisma from "../database/client.js";
import { detectPlatform, checkLinkStatus } from "../checkers/statusChecker.js";
import { getStatusEmoji, formatCambodiaTime } from "../utils/formatters.js";
import { logger } from "../utils/logger.js";
import { Markup } from "telegraf";

const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";

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
    return ctx.reply("❌ <b>Invalid URL format.</b> Please send a valid web address.", { parse_mode: "HTML" });
  }

  const url = text;
  const platform = detectPlatform(url);
  if (!platform) {
    return ctx.reply("⚠️ <b>Unsupported platform.</b> I currently support:\n• Facebook\n• Instagram\n• TikTok\n• YouTube", { parse_mode: "HTML" });
  }

  try {
    const existingLink = await prisma.link.findFirst({
      where: { userId: ctx.dbUser.id, url: url },
    });

    if (existingLink) {
      return ctx.reply("✅ <b>You are already monitoring this link!</b>", { parse_mode: "HTML" });
    }

    const waitMsg = await ctx.reply("🔍 <i>Analyzing URL... please wait.</i>", { parse_mode: "HTML" });
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

    let caption = `<b>✅ LINK ADDED SUCCESSFULLY</b>\n${DIVIDER}\n`;
    caption += `<b>Platform:</b> ${platform}\n`;
    if (name) caption += `<b>Name:</b> ${name}\n`;
    caption += `\n<b>Status:</b> ${getStatusEmoji(currentStatus)}\n`;
    caption += `${DIVIDER}\n`;
    caption += `<a href="${url}">🔗 View Profile</a>`;

    const replyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: getStatusEmoji(currentStatus), callback_data: "status_btn_ignore" }]
        ]
      }
    };

    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
    } catch (e) {} 

    if (photoUrl) {
      try {
        await ctx.replyWithPhoto(photoUrl, { caption, parse_mode: "HTML", ...replyMarkup });
      } catch (photoError) {
        logger.error(`Failed to send photo: ${photoError.message}`);
        await ctx.reply(caption, { parse_mode: "HTML", disable_web_page_preview: true, ...replyMarkup });
      }
    } else {
      await ctx.reply(caption, { parse_mode: "HTML", disable_web_page_preview: true, ...replyMarkup });
    }
  } catch (error) {
    logger.error(`Error in add link: ${error.message}`);
    await ctx.reply("❌ <b>An error occurred</b> while adding the link. Please try again later.", { parse_mode: "HTML" });
  }
};

const mainMenu = Markup.keyboard([
  ['📊 Status', '📋 My Links'],
  ['➕ Add Link', '🗑️ Remove Link']
]).resize();

export const setupCommands = (bot) => {
  bot.command("start", (ctx) => {
    ctx.reply(
      `<b>🌟 ADS SOCIAL CHECKER 🌟</b>\n${DIVIDER}\n` +
      `Welcome to your premium monitoring dashboard.\n\n` +
      `<b>Supported Platforms:</b>\n` +
      `• Facebook\n• Instagram\n• TikTok\n• YouTube\n\n` +
      `<i>Use the menu below to navigate! 👇</i>`,
      { 
        parse_mode: "HTML",
        ...mainMenu
      }
    );
  });

  bot.hears('➕ Add Link', (ctx) => {
    ctx.reply(`🔗 <b>How to add a link:</b>\n\nJust paste the Facebook, Instagram, TikTok, or YouTube URL directly into this chat!`, {
      parse_mode: "HTML",
      ...mainMenu
    });
  });

  const handleRemoveMenu = async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("📭 <b>You don't have any links to remove.</b>", { parse_mode: "HTML", ...mainMenu });
      }

      const buttons = links.map((link) => {
        let label = `❌ [${link.platform}] `;
        if (link.name) {
          label += link.name.length > 20 ? link.name.substring(0, 20) + "..." : link.name;
        } else {
          label += link.url.length > 25 ? link.url.substring(0, 25) + "..." : link.url;
        }
        return [Markup.button.callback(label, `remove_${link.id}`)];
      });

      buttons.push([Markup.button.callback("🚫 Cancel", "cancel_remove")]);

      ctx.reply("🗑️ <b>Select a link to remove:</b>", {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (error) {
      logger.error(`Error generating remove menu: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching your links.");
    }
  };

  bot.hears('🗑️ Remove Link', handleRemoveMenu);

  bot.action(/^remove_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    try {
      const link = await prisma.link.findFirst({
        where: { id: linkId, userId: ctx.dbUser.id },
      });

      if (!link) {
        await ctx.answerCbQuery("Link not found.");
        return ctx.editMessageText("❌ This link has already been removed or does not exist.", { parse_mode: "HTML" });
      }

      await prisma.link.delete({
        where: { id: link.id },
      });

      await ctx.answerCbQuery("Link removed!");
      ctx.editMessageText(`✅ <b>Successfully removed:</b>\n${link.url}`, { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Error deleting link via button: ${error.message}`);
      ctx.answerCbQuery("Error removing link.", { show_alert: true });
    }
  });

  bot.action("cancel_remove", (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText("🚫 <i>Removal canceled.</i>", { parse_mode: "HTML" });
  });

  const sendList = async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("📭 <b>You are not tracking any links yet.</b> Paste a link to get started!", { parse_mode: "HTML", ...mainMenu });
      }

      let message = `<b>📋 YOUR MONITORED LINKS</b>\n${DIVIDER}\n`;
      links.forEach((link, idx) => {
        message += `<b>${idx + 1}.</b> [${link.platform}] <a href="${link.url}">Profile Link</a>\n`;
      });
      message += `${DIVIDER}`;

      ctx.reply(message, { parse_mode: "HTML", disable_web_page_preview: true, ...mainMenu });
    } catch (error) {
      logger.error(`Error in list: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching your links.");
    }
  };

  const sendStatus = async (ctx) => {
    try {
      const links = await prisma.link.findMany({
        where: { userId: ctx.dbUser.id },
      });

      if (links.length === 0) {
        return ctx.reply("📭 <b>You are not tracking any links yet.</b>", { parse_mode: "HTML", ...mainMenu });
      }

      let message = `<b>📊 LIVE STATUS REPORT</b>\n${DIVIDER}\n`;
      links.forEach((link, idx) => {
        const emoji = getStatusEmoji(link.currentStatus);
        const namePart = link.name ? ` (${link.name})` : "";
        message += `<b>${idx + 1}. ${link.platform}</b>${namePart}\n`;
        message += `Status: ${emoji}\n`;
        message += `<a href="${link.url}">🔗 View Profile</a>\n\n`;
      });
      message += `${DIVIDER}`;

      ctx.reply(message, { parse_mode: "HTML", disable_web_page_preview: true, ...mainMenu });
    } catch (error) {
      logger.error(`Error in status: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching statuses.");
    }
  };

  bot.hears('📋 My Links', sendList);
  bot.command("list", sendList);

  bot.hears('📊 Status', sendStatus);
  bot.command("status", sendStatus);

  bot.command("help", (ctx) => {
    ctx.reply(
      `<b>🛠️ AVAILABLE COMMANDS</b>\n${DIVIDER}\n` +
        "🔹 /add <code>&lt;url&gt;</code> - Monitor a new link\n" +
        "🔹 /remove - Stop monitoring a link\n" +
        "🔹 /list - View all your tracked links\n" +
        "🔹 /status - Check the live status of your links\n" +
        "🔹 /history <code>&lt;url&gt;</code> - View the status history of a link\n" +
        "🔹 /check <code>&lt;url&gt;</code> - Force a manual status check right now\n\n" +
        "<i>(You can also just use the menu buttons!)</i>",
      { parse_mode: "HTML", ...mainMenu }
    );
  });

  bot.command("add", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("⚠️ <b>Please provide a URL.</b>\nUsage: <code>/add &lt;url&gt;</code>", { parse_mode: "HTML" });
    }
    await handleAddLink(ctx, parts[1]);
  });

  bot.command("remove", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return handleRemoveMenu(ctx);
    }

    const url = parts[1];
    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (!link) {
        return ctx.reply("❌ <b>Link not found</b> in your tracking list.", { parse_mode: "HTML" });
      }

      await prisma.link.delete({
        where: { id: link.id },
      });

      ctx.reply("🗑️ <b>Link removed successfully.</b>", { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Error in /remove: ${error.message}`);
      ctx.reply("❌ An error occurred while removing the link.");
    }
  });

  bot.command("check", async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(" ");
    if (parts.length < 2) {
      return ctx.reply("⚠️ <b>Please provide a URL.</b>\nUsage: <code>/check &lt;url&gt;</code>", { parse_mode: "HTML" });
    }

    const url = parts[1];
    try {
      const link = await prisma.link.findFirst({
        where: { userId: ctx.dbUser.id, url: url },
      });

      if (!link) {
        return ctx.reply("❌ <b>Link not found.</b> Please add it first.", { parse_mode: "HTML" });
      }

      const waitMsg = await ctx.reply("🔍 <i>Running manual check...</i>", { parse_mode: "HTML" });
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

        let message = `<b>🚨 ALERT: MANUAL CHECK UPDATE</b>\n${DIVIDER}\n`;
        message += `<b>Account:</b> ${newName || link.name || "N/A"}\n`;
        message += `<b>Platform:</b> ${link.platform}\n\n`;
        if (statusChanged) {
          message += `<b>Previous:</b> ${getStatusEmoji(link.currentStatus)}\n`;
          message += `<b>Current:</b> ${getStatusEmoji(newStatus)}\n`;
        } else {
          message += `<b>Status:</b> ${getStatusEmoji(newStatus)}\n`;
        }
        if (photoChanged) message += `\n<b>Notice:</b> New Photo Detected! 📸\n`;
        message += `\n<b>Time:</b> ${formatCambodiaTime(now)}\n`;
        message += `${DIVIDER}\n`;
        message += `<a href="${link.url}">🔗 View Profile</a>`;

        if (photoChanged && newPhotoUrl) {
          try {
            await ctx.replyWithPhoto(newPhotoUrl, { caption: message, parse_mode: "HTML" });
          } catch (photoError) {
            logger.error(`Failed to send photo: ${photoError.message}`);
            await ctx.reply(message, { parse_mode: "HTML", disable_web_page_preview: true });
          }
        } else {
          await ctx.reply(message, { parse_mode: "HTML", disable_web_page_preview: true });
        }
      } else {
        await prisma.link.update({
          where: { id: link.id },
          data: { lastChecked: now },
        });
        
        let msg = `<b>✅ STATUS UNCHANGED</b>\n${DIVIDER}\n`;
        if (link.name) msg += `<b>Account:</b> ${link.name}\n`;
        msg += `<b>Status:</b> ${getStatusEmoji(newStatus)}\n\n`;
        msg += `<b>Checked at:</b> ${formatCambodiaTime(now)}\n`;
        msg += `${DIVIDER}`;

        await ctx.reply(msg, { parse_mode: "HTML" });
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
      return ctx.reply("⚠️ <b>Please provide a URL.</b>\nUsage: <code>/history &lt;url&gt;</code>", { parse_mode: "HTML" });
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
        return ctx.reply("❌ <b>Link not found</b> in your tracking list.", { parse_mode: "HTML" });
      }

      if (link.histories.length === 0) {
        return ctx.reply("📭 <b>No history available</b> for this link yet.", { parse_mode: "HTML" });
      }

      let message = `<b>🕒 STATUS HISTORY</b>\n${DIVIDER}\n`;
      message += `<b>Platform:</b> ${link.platform}\n\n`;
      link.histories.forEach((h) => {
        message += `• ${getStatusEmoji(h.status)} - ${formatCambodiaTime(h.checkedAt)}\n`;
      });
      message += `\n${DIVIDER}\n`;
      message += `<a href="${link.url}">🔗 View Profile</a>`;

      ctx.reply(message, { parse_mode: "HTML", disable_web_page_preview: true });
    } catch (error) {
      logger.error(`Error in /history: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching history.");
    }
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/")) {
      return next();
    }
    const menuCommands = ['📊 Status', '📋 My Links', '➕ Add Link', '🗑️ Remove Link'];
    if (ctx.message && ctx.message.text && menuCommands.includes(ctx.message.text)) {
      return next();
    }
    
    if (!ctx.message || !ctx.message.text) return next();

    const text = ctx.message.text.trim();
    if (isValidUrl(text)) {
      await handleAddLink(ctx, text);
    }
  });
};
