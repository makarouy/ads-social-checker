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

const generateDashboardFolders = async (userId) => {
  const allCount = await prisma.link.count({ where: { userId, isArchived: false } });
  
  if (allCount === 0) {
    const archiveCount = await prisma.link.count({ where: { userId, isArchived: true } });
    if (archiveCount > 0) {
      return {
        text: `📭 <b>You have no active links.</b>\nBut you have ${archiveCount} archived jobs.`,
        markup: Markup.inlineKeyboard([[Markup.button.callback(`📦 View Archives (${archiveCount})`, `list_archived_0`)]])
      };
    }
    return { text: "📭 <b>You are not tracking any links yet.</b> Paste a link to get started!", markup: null };
  }

  const liveCount = await prisma.link.count({
    where: { userId, currentStatus: 'LIVE', isArchived: false }
  });
  const deadCount = await prisma.link.count({
    where: { userId, currentStatus: { in: ['DISABLED', 'DELETED', 'NOT_FOUND', 'UNKNOWN'] }, isArchived: false }
  });
  const archiveCount = await prisma.link.count({
    where: { userId, isArchived: true }
  });

  const buttons = [
    [Markup.button.callback(`🗂️ All Active Links (${allCount})`, `list_all_0`)],
    [Markup.button.callback(`🔴 Disabled / Dead (${deadCount})`, `list_dead_0`)],
    [Markup.button.callback(`🟢 Live / Recovered (${liveCount})`, `list_live_0`)],
    [Markup.button.callback(`📦 Archived Jobs (${archiveCount})`, `list_archived_0`)],
    [
      Markup.button.callback(`📘 FB`, `list_fb_0`),
      Markup.button.callback(`📸 IG`, `list_ig_0`),
      Markup.button.callback(`🎵 TikTok`, `list_tt_0`),
      Markup.button.callback(`▶️ YouTube`, `list_yt_0`)
    ]
  ];

  return {
    text: `<b>🗂️ MASTER DASHBOARD</b>\n${DIVIDER}\n<i>Select a category to view your links:</i>`,
    markup: Markup.inlineKeyboard(buttons)
  };
};

const generateDashboardList = async (userId, filter, page) => {
  let whereClause = { userId, isArchived: false };
  let title = "ACTIVE LINKS";

  if (filter === "dead") {
    whereClause.currentStatus = { in: ['DISABLED', 'DELETED', 'NOT_FOUND', 'UNKNOWN'] };
    title = "DISABLED / DEAD ACCOUNTS";
  } else if (filter === "live") {
    whereClause.currentStatus = 'LIVE';
    title = "LIVE / RECOVERED ACCOUNTS";
  } else if (filter === "fb") {
    whereClause.platform = 'Facebook';
    title = "FACEBOOK ACCOUNTS";
  } else if (filter === "ig") {
    whereClause.platform = 'Instagram';
    title = "INSTAGRAM ACCOUNTS";
  } else if (filter === "tt") {
    whereClause.platform = 'TikTok';
    title = "TIKTOK ACCOUNTS";
  } else if (filter === "yt") {
    whereClause.platform = 'YouTube';
    title = "YOUTUBE ACCOUNTS";
  } else if (filter === "archived") {
    whereClause.isArchived = true;
    title = "ARCHIVED JOBS";
  }

  const pageSize = 10;
  const totalLinks = await prisma.link.count({ where: whereClause });
  const totalPages = Math.ceil(totalLinks / pageSize);
  
  if (totalLinks === 0) {
    return {
      text: `<b>🗂️ ${title}</b>\n${DIVIDER}\n📭 No links found in this category.`,
      markup: Markup.inlineKeyboard([[Markup.button.callback("🔙 Back to Folders", "dashboard_folders")]])
    };
  }

  const links = await prisma.link.findMany({
    where: whereClause,
    take: pageSize,
    skip: page * pageSize,
    orderBy: { id: 'desc' }
  });

  const buttons = links.map((link) => {
    let label = `${getStatusEmoji(link.currentStatus).split(' ')[0]} `;
    if (link.isMuted) label += "🔕 ";
    label += `[${link.platform}] `;
    if (link.name) {
      label += link.name.length > 20 ? link.name.substring(0, 20) + "..." : link.name;
    } else {
      label += link.url.length > 25 ? link.url.substring(0, 25) + "..." : link.url;
    }
    return [Markup.button.callback(label, `view_link_${link.id}`)];
  });

  // Pagination buttons
  const navButtons = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback("⬅️ Prev", `list_${filter}_${page - 1}`));
  }
  if (page < totalPages - 1) {
    navButtons.push(Markup.button.callback("Next ➡️", `list_${filter}_${page + 1}`));
  }
  
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }
  buttons.push([Markup.button.callback("🔙 Back to Folders", "dashboard_folders")]);

  return {
    text: `<b>🗂️ ${title} (Page ${page + 1}/${totalPages})</b>\n${DIVIDER}\n<i>Select a link to manage it:</i>`,
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
  message += `<b>Account:</b> ${link.name || "N/A"}\n`;
  message += `<b>Followers:</b> ${link.followerCount || "Hidden / Anti-Bot"} 📈\n\n`;
  
  if (link.isArchived) {
    message += `<b>Status:</b> 📦 ARCHIVED\n`;
  } else {
    message += `<b>Status:</b> ${getStatusEmoji(link.currentStatus)}\n`;
    message += `<b>Last Checked:</b> ${formatCambodiaTime(link.lastChecked)}\n`;
  }
  message += `${DIVIDER}\n`;
  message += `<a href="${link.url}">🔗 Open Profile</a>`;

  let actionRow = [];
  if (link.isArchived) {
    actionRow = [
      Markup.button.callback("♻️ Restore (Unarchive)", `restore_link_${link.id}`),
      Markup.button.callback("🗑️ Delete", `remove_link_${link.id}`)
    ];
  } else {
    actionRow = [
      Markup.button.callback("📦 Archive", `archive_link_${link.id}`),
      Markup.button.callback("🗑️ Delete", `remove_link_${link.id}`)
    ];
  }

  const markup = Markup.inlineKeyboard([
    [
      Markup.button.callback("🔍 Check", `check_link_${link.id}`),
      Markup.button.callback("🕒 History", `history_link_${link.id}`)
    ],
    [
      link.isMuted
        ? Markup.button.callback("🔔 Unmute Alerts", `unmute_link_${link.id}`)
        : Markup.button.callback("🔕 Mute Alerts", `mute_link_${link.id}`)
    ],
    actionRow,
    [Markup.button.callback("🔙 Back to Folders", "dashboard_folders")]
  ]);

  return { text: message, markup, photoUrl: link.photoUrl };
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
      const { text, markup } = await generateDashboardFolders(ctx.dbUser.id);
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

  bot.action("dashboard_folders", async (ctx) => {
    try {
      const { text, markup } = await generateDashboardFolders(ctx.dbUser.id);
      try { await ctx.deleteMessage(); } catch(e){}
      if (!markup) {
        await ctx.reply(text, { parse_mode: "HTML" });
      } else {
        await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
      }
      ctx.answerCbQuery();
    } catch (error) {
      logger.error(`Error in dashboard_folders: ${error.message}`);
      ctx.answerCbQuery("Error loading folders.", { show_alert: true });
    }
  });

  bot.action(/^list_([a-z]+)_(\d+)$/, async (ctx) => {
    const filter = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);
    try {
      const { text, markup } = await generateDashboardList(ctx.dbUser.id, filter, page);
      try {
        await ctx.editMessageText(text, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
      } catch (err) {
        // Fallback if coming from a photo
        try { await ctx.deleteMessage(); } catch(e){}
        await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
      }
      ctx.answerCbQuery();
    } catch (error) {
      logger.error(`Error in list page: ${error.message}`);
      ctx.answerCbQuery("Error loading list.", { show_alert: true });
    }
  });

  bot.action(/^view_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      const panel = await generateControlPanel(idInt, ctx.dbUser.id);
      if (!panel) {
        ctx.answerCbQuery("Link not found.");
        return ctx.reply("❌ <b>This link has been removed or does not exist.</b>", { parse_mode: "HTML" });
      }
      
      try { await ctx.deleteMessage(); } catch(e){}
      
      if (panel.photoUrl) {
        try {
          await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup });
        } catch(imgErr) {
          await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
        }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
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
      
      const { status: newStatus, name: newName, photoUrl: newPhotoUrl, followerCount: newFollowers } = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      let statusChanged = newStatus !== link.currentStatus && newStatus !== "UNKNOWN";
      let nameChanged = newName && newName !== link.name;
      let photoChanged = newPhotoUrl && newPhotoUrl !== link.photoUrl;
      let followersChanged = newFollowers && newFollowers !== link.followerCount;

      if (statusChanged || nameChanged || photoChanged || followersChanged) {
        if (statusChanged) {
          await prisma.history.create({ data: { linkId: link.id, status: newStatus } });
        }
        await prisma.link.update({
          where: { id: link.id },
          data: {
            ...(statusChanged && { lastStatus: link.currentStatus, currentStatus: newStatus, lastChanged: now }),
            ...(nameChanged && { name: newName }),
            ...(photoChanged && { photoUrl: newPhotoUrl }),
            ...(followersChanged && { followerCount: newFollowers }),
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
      try { await ctx.deleteMessage(); } catch(e){}
      
      if (panel.photoUrl) {
        try {
          await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup });
        } catch (err) {
          await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
        }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
      
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
          Markup.button.callback("🗂️ Folders", "dashboard_folders")
        ]
      ]);

      try { await ctx.deleteMessage(); } catch(e){}
      await ctx.reply(message, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
      ctx.answerCbQuery();
    } catch (error) {
      logger.error(`Error in history_link: ${error.message}`);
      ctx.answerCbQuery("❌ Error fetching history.", { show_alert: true });
    }
  });

  bot.action(/^mute_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      await prisma.link.updateMany({
        where: { id: idInt, userId: ctx.dbUser.id },
        data: { isMuted: true }
      });
      await ctx.answerCbQuery("🔕 Alerts Muted!");
      const panel = await generateControlPanel(idInt, ctx.dbUser.id);
      try { await ctx.deleteMessage(); } catch(e){}
      if (panel.photoUrl) {
        try { await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup }); } 
        catch (e) { await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup }); }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
    } catch (error) {
      ctx.answerCbQuery("Error muting link.", { show_alert: true });
    }
  });

  bot.action(/^unmute_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      await prisma.link.updateMany({
        where: { id: idInt, userId: ctx.dbUser.id },
        data: { isMuted: false }
      });
      await ctx.answerCbQuery("🔔 Alerts Unmuted!");
      const panel = await generateControlPanel(idInt, ctx.dbUser.id);
      try { await ctx.deleteMessage(); } catch(e){}
      if (panel.photoUrl) {
        try { await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup }); } 
        catch (e) { await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup }); }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
    } catch (error) {
      ctx.answerCbQuery("Error unmuting link.", { show_alert: true });
    }
  });

  bot.action(/^archive_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      await prisma.link.updateMany({
        where: { id: idInt, userId: ctx.dbUser.id },
        data: { isArchived: true }
      });
      await ctx.answerCbQuery("📦 Link Archived!");
      const panel = await generateControlPanel(idInt, ctx.dbUser.id);
      try { await ctx.deleteMessage(); } catch(e){}
      if (panel.photoUrl) {
        try { await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup }); } 
        catch (e) { await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup }); }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
    } catch (error) {
      ctx.answerCbQuery("Error archiving link.", { show_alert: true });
    }
  });

  bot.action(/^restore_link_(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    const idInt = parseInt(linkId, 10);
    try {
      await prisma.link.updateMany({
        where: { id: idInt, userId: ctx.dbUser.id },
        data: { isArchived: false, lastChecked: new Date() } // reset checked time so it gets checked soon
      });
      await ctx.answerCbQuery("♻️ Link Restored to Active tracking!");
      const panel = await generateControlPanel(idInt, ctx.dbUser.id);
      try { await ctx.deleteMessage(); } catch(e){}
      if (panel.photoUrl) {
        try { await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup }); } 
        catch (e) { await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup }); }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
    } catch (error) {
      ctx.answerCbQuery("Error restoring link.", { show_alert: true });
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
        [Markup.button.callback("🔙 Back to Folders", "dashboard_folders")]
      ]);
      
      try { await ctx.deleteMessage(); } catch(e){}
      await ctx.reply(`✅ <b>Successfully removed:</b>\n${link.url}`, { parse_mode: "HTML", disable_web_page_preview: true, ...markup });
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

  // Multi-Tenant Group Chat Routing Commands
  bot.command("linkgroup", async (ctx) => {
    if (ctx.chat.type === "private") {
      return ctx.reply("⚠️ You must use this command inside a Telegram Group Chat, not in my private DMs.", { parse_mode: "HTML" });
    }
    try {
      await prisma.user.update({
        where: { id: ctx.dbUser.id },
        data: { groupChatId: ctx.chat.id.toString() }
      });
      ctx.reply(`✅ <b>Success!</b>\n\nYour account is now securely linked to this group.\nAll of your recovered account alerts will be broadcasted here automatically.`, { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Error linking group: ${error.message}`);
      ctx.reply("❌ Failed to link group.");
    }
  });

  bot.command("unlinkgroup", async (ctx) => {
    try {
      await prisma.user.update({
        where: { id: ctx.dbUser.id },
        data: { groupChatId: null }
      });
      ctx.reply("✅ <b>Group Unlinked!</b>\n\nYour alerts will now only be sent to your private DMs.", { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Error unlinking group: ${error.message}`);
      ctx.reply("❌ Failed to unlink group.");
    }
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/")) {
      return next();
    }
    const menuCommands = ['📊 Status', '📋 My Links', '➕ Add Link'];
    if (ctx.message && ctx.message.text && menuCommands.includes(ctx.message.text)) {
      if (ctx.message.text === '➕ Add Link') {
        return ctx.reply("📝 <b>How to add a link:</b>\n\n1. Paste a full URL (e.g. <i>https://facebook.com/zuck</i>)\n2. Or just send a <b>Facebook UID</b> (e.g. <i>4</i> or <i>1000123456789</i>)", { parse_mode: "HTML" });
      }
      return next();
    }
    
    if (!ctx.message || !ctx.message.text) return next();

    const text = ctx.message.text.trim();
    if (isValidUrl(text)) {
      await handleAddLink(ctx, text);
    } else if (/^\d+$/.test(text)) {
      // If the user sends just numbers, assume it's a Facebook UID
      const fbUrl = `https://facebook.com/${text}`;
      await handleAddLink(ctx, fbUrl);
    }
  });
};
