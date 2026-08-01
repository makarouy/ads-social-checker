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
  ['➕ Add Link']
]).resize();

const generateDashboardList = async (userId) => {
  const links = await prisma.link.findMany({
    where: { userId },
  });

  if (links.length === 0) {
    return { text: "📭 <b>You are not tracking any links yet.</b> Paste a link to get started!", markup: null };
  }

  const buttons = links.map((link) => {
    let label = `${getStatusEmoji(link.currentStatus).split(' ')[0]} [${link.platform}] `;
    if (link.name) {
      label += link.name.length > 20 ? link.name.substring(0, 20) + "..." : link.name;
    } else {
      label += link.url.length > 25 ? link.url.substring(0, 25) + "..." : link.url;
    }
    return [Markup.button.callback(label, `view_link_${link.id}`)];
  });

  return {
    text: `<b>📋 MASTER LINK DASHBOARD</b>\n${DIVIDER}\n<i>Select a link to manage it:</i>`,
    markup: Markup.inlineKeyboard(buttons)
  };
};

const generateControlPanel = async (linkId, userId) => {
  const idInt = parseInt(linkId, 10);
  const link = await prisma.link.findFirst({
    where: { id: idInt, userId: userId },
  });

  if (!link) return null;

  let message = `<b>⚙️ LINK CONTROL PANEL</b>\n${DIVIDER}\n`;
  message += `<b>Platform:</b> ${link.platform}\n`;
  message += `<b>Account:</b> ${link.name || "N/A"}\n\n`;
  message += `<b>Status:</b> ${getStatusEmoji(link.currentStatus)}\n`;
  message += `<b>Last Checked:</b> ${formatCambodiaTime(link.lastChecked)}\n`;
  message += `${DIVIDER}\n`;
  message += `<a href="${link.url}">🔗 Open Profile</a>`;

  const markup = Markup.inlineKeyboard([
    [
      Markup.button.callback("🔍 Check", `check_link_${link.id}`),
      Markup.button.callback("🕒 History", `history_link_${link.id}`)
    ],
    [
      Markup.button.callback("🗑️ Remove", `remove_link_${link.id}`),
      Markup.button.callback("🔙 Back", "dashboard_list")
    ]
  ]);

  return { text: message, markup };
};

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

  const sendDashboard = async (ctx) => {
    try {
      const { text, markup } = await generateDashboardList(ctx.dbUser.id);
      if (!markup) {
        return ctx.reply(text, { parse_mode: "HTML", ...mainMenu });
      }
      ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
    } catch (error) {
      logger.error(`Error in sendDashboard: ${error.message}`);
      ctx.reply("❌ An error occurred while fetching your dashboard.", { parse_mode: "HTML" });
    }
  };

  bot.hears('📋 My Links', sendDashboard);
  bot.command("list", sendDashboard);

  bot.action("dashboard_list", async (ctx) => {
    try {
      const { text, markup } = await generateDashboardList(ctx.dbUser.id);
      if (!markup) {
        return ctx.editMessageText(text, { parse_mode: "HTML" });
      }
      ctx.editMessageText(text, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
      ctx.answerCbQuery();
    } catch (error) {
      logger.error(`Error in dashboard_list: ${error.message}`);
      ctx.answerCbQuery("Error loading dashboard.", { show_alert: true });
    }
  });

  bot.action(/^view_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    try {
      const panel = await generateControlPanel(linkId, ctx.dbUser.id);
      if (!panel) {
        ctx.answerCbQuery("Link not found.");
        return ctx.editMessageText("❌ <b>This link has been removed or does not exist.</b>", { parse_mode: "HTML" });
      }
      ctx.editMessageText(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      ctx.answerCbQuery();
    } catch (error) {
      logger.error(`Error in view_link: ${error.message}`);
      ctx.answerCbQuery("Error loading control panel.", { show_alert: true });
    }
  });

  bot.action(/^check_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      const link = await prisma.link.findFirst({
        where: { id: idInt, userId: ctx.dbUser.id },
      });

      if (!link) {
        ctx.answerCbQuery("Link not found.");
        return ctx.editMessageText("❌ <b>Link not found.</b>", { parse_mode: "HTML" });
      }

      await ctx.answerCbQuery("🔍 Running manual check... Please wait.");
      
      const { status: newStatus, name: newName, photoUrl: newPhotoUrl } = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      let statusChanged = newStatus !== link.currentStatus && newStatus !== "UNKNOWN";
      let nameChanged = newName && newName !== link.name;
      let photoChanged = newPhotoUrl && newPhotoUrl !== link.photoUrl;

      if (statusChanged || nameChanged || photoChanged) {
        if (statusChanged) {
          await prisma.history.create({ data: { linkId: link.id, status: newStatus } });
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
      } else {
        await prisma.link.update({
          where: { id: link.id },
          data: { lastChecked: now },
        });
      }

      // Re-generate the panel with updated data
      const panel = await generateControlPanel(linkId, ctx.dbUser.id);
      ctx.editMessageText(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      
    } catch (error) {
      logger.error(`Error in check_link: ${error.message}`);
      ctx.answerCbQuery("❌ Error during manual check.", { show_alert: true });
    }
  });

  bot.action(/^history_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      const link = await prisma.link.findFirst({
        where: { id: idInt, userId: ctx.dbUser.id },
        include: { histories: { orderBy: { checkedAt: 'desc' }, take: 10 } }
      });

      if (!link) {
        return ctx.editMessageText("❌ <b>Link not found.</b>", { parse_mode: "HTML" });
      }

      let message = `<b>🕒 STATUS HISTORY</b>\n${DIVIDER}\n`;
      message += `<b>Platform:</b> ${link.platform}\n\n`;
      
      if (link.histories.length === 0) {
        message += `<i>No history available yet.</i>\n`;
      } else {
        link.histories.forEach((h) => {
          message += `• ${getStatusEmoji(h.status)} - ${formatCambodiaTime(h.checkedAt)}\n`;
        });
      }
      message += `\n${DIVIDER}\n`;

      const markup = Markup.inlineKeyboard([
        [
          Markup.button.callback("🔙 Panel", `view_link_${link.id}`),
          Markup.button.callback("📋 List", "dashboard_list")
        ]
      ]);

      ctx.editMessageText(message, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
      ctx.answerCbQuery();
    } catch (error) {
      logger.error(`Error in history_link: ${error.message}`);
      ctx.answerCbQuery("❌ Error fetching history.", { show_alert: true });
    }
  });

  bot.action(/^remove_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      const link = await prisma.link.findFirst({
        where: { id: idInt, userId: ctx.dbUser.id },
      });

      if (!link) {
        await ctx.answerCbQuery("Link not found.");
        return ctx.editMessageText("❌ <b>This link has already been removed.</b>", { parse_mode: "HTML" });
      }

      await prisma.link.delete({
        where: { id: link.id },
      });

      await ctx.answerCbQuery("Link removed!");
      
      const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back to Master List", "dashboard_list")]
      ]);
      
      ctx.editMessageText(`✅ <b>Successfully removed:</b>\n${link.url}`, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
    } catch (error) {
      logger.error(`Error deleting link via button: ${error.message}`);
      ctx.answerCbQuery("Error removing link.", { show_alert: true });
    }
  });

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

  bot.hears('📊 Status', sendStatus);
  bot.command("status", sendStatus);

  bot.command("help", (ctx) => {
    ctx.reply(
      `<b>🛠️ HOW TO USE</b>\n${DIVIDER}\n` +
        "Simply paste a social media link into this chat and the bot will immediately start monitoring it.\n\n" +
        "Use the buttons on your keyboard to navigate the dashboard. Tap <b>📋 My Links</b> to view, check, and manage your profiles.",
      { parse_mode: "HTML", ...mainMenu }
    );
  });

  // Legacy command fallbacks (point them to the interactive dashboard)
  bot.command(["add", "remove", "check", "history"], (ctx) => {
    ctx.reply("⚠️ <b>Legacy Command</b>\n\nPlease use the interactive menu buttons below, or simply paste a URL directly into the chat to add a link.", { parse_mode: "HTML", ...mainMenu });
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/")) {
      return next();
    }
    const menuCommands = ['📊 Status', '📋 My Links', '➕ Add Link'];
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
