import prisma from "../database/client.js";
import { detectPlatform, checkLinkStatus } from "../checkers/statusChecker.js";
import { getStatusEmoji, formatCambodiaTime } from "../utils/formatters.js";
import { logger } from "../utils/logger.js";
import { Markup } from "telegraf";
import { updateUserMenu } from "./menu.js";

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
    const { status: currentStatus, name, photoUrl, followerCount } = await checkLinkStatus(platform, url);

    const newLink = await prisma.link.create({
      data: {
        userId: ctx.dbUser.id,
        platform,
        url,
        name,
        photoUrl,
        followerCount,
        currentStatus,
        lastChecked: new Date(),
      },
    });

    let caption = `<b>✅ LINK ADDED SUCCESSFULLY</b>\n${DIVIDER}\n`;
    caption += `<b>Platform:</b> ${platform}\n`;
    if (name) caption += `<b>Name:</b> ${name}\n`;
    if (followerCount) caption += `<b>Followers:</b> ${followerCount} 📈\n`;
    caption += `\n<b>Status:</b> ${getStatusEmoji(currentStatus)}\n`;
    caption += `${DIVIDER}\n`;
    caption += `<a href="${url}">🔗 View Profile</a>`;

    const replyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: getStatusEmoji(currentStatus), callback_data: "status_btn_ignore" }],
          [{ text: "📁 Move to Folder", callback_data: `move_link_${newLink.id}` }]
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
  ['➕ Add Link', '📞 Contact Support']
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

  // Fetch Folders
  const folders = await prisma.folder.findMany({ 
    where: { userId }, 
    orderBy: { id: 'asc' }, 
    include: { _count: { select: { links: { where: { isArchived: false } } } } } 
  });

  const buttons = [];
  
  // Generate a button for each Folder
  folders.forEach(folder => {
    buttons.push([Markup.button.callback(`📁 ${folder.name} (${folder._count.links})`, `list_folder_${folder.id}_0`)]);
  });

  // Calculate uncategorized
  const uncategorizedCount = await prisma.link.count({
    where: { userId, folderId: null, isArchived: false }
  });

  if (uncategorizedCount > 0) {
    buttons.push([Markup.button.callback(`🗂️ Uncategorized Links (${uncategorizedCount})`, `list_uncategorized_0`)]);
  }

  // Legacy buttons for dead, live, archived
  const liveCount = await prisma.link.count({
    where: { userId, currentStatus: 'LIVE', isArchived: false }
  });
  const deadCount = await prisma.link.count({
    where: { userId, currentStatus: { in: ['DISABLED', 'DELETED', 'NOT_FOUND', 'UNKNOWN'] }, isArchived: false }
  });
  const archiveCount = await prisma.link.count({
    where: { userId, isArchived: true }
  });

  if (folders.length === 0 && uncategorizedCount === 0) {
    buttons.push([Markup.button.callback(`🗂️ All Active Links (${allCount})`, `list_all_0`)]);
  }

  buttons.push([Markup.button.callback(`🔴 Disabled / Dead (${deadCount})`, `list_dead_0`)]);
  buttons.push([Markup.button.callback(`🟢 Live / Recovered (${liveCount})`, `list_live_0`)]);
  buttons.push([Markup.button.callback(`📦 Archived Jobs (${archiveCount})`, `list_archived_0`)]);

  return {
    text: `<b>🗂️ MASTER DASHBOARD</b>\n${DIVIDER}\n<i>Select a category to view your links:</i>\n\n💡 <b>Tip:</b> Use <code>/folder</code> to organize your links!`,
    markup: Markup.inlineKeyboard(buttons)
  };
};

const generateDashboardList = async (userId, filter, page) => {
  let whereClause = { userId, isArchived: false };
  let title = "ACTIVE LINKS";

  if (filter.startsWith("folder_")) {
    const folderId = parseInt(filter.split("_")[1], 10);
    whereClause.folderId = folderId;
    const folder = await prisma.folder.findFirst({ where: { id: folderId } });
    title = folder ? `📁 ${folder.name.toUpperCase()}` : "📁 FOLDER";
  } else if (filter === "uncategorized") {
    whereClause.folderId = null;
    title = "🗂️ UNCATEGORIZED LINKS";
  } else if (filter === "dead") {
    whereClause.currentStatus = { in: ['DISABLED', 'DELETED', 'NOT_FOUND', 'UNKNOWN'] };
    title = "🔴 DISABLED / DEAD ACCOUNTS";
  } else if (filter === "live") {
    whereClause.currentStatus = 'LIVE';
    title = "🟢 LIVE / RECOVERED ACCOUNTS";
  } else if (filter === "fb") {
    whereClause.platform = 'Facebook';
    title = "📘 FACEBOOK ACCOUNTS";
  } else if (filter === "ig") {
    whereClause.platform = 'Instagram';
    title = "📸 INSTAGRAM ACCOUNTS";
  } else if (filter === "tt") {
    whereClause.platform = 'TikTok';
    title = "🎵 TIKTOK ACCOUNTS";
  } else if (filter === "yt") {
    whereClause.platform = 'YouTube';
    title = "▶️ YOUTUBE ACCOUNTS";
  } else if (filter === "archived") {
    whereClause.isArchived = true;
    title = "📦 ARCHIVED JOBS";
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
  message += `<b>ID:</b> ${link.id}\n`;
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
      Markup.button.callback("📁 Move to Folder", `move_link_${link.id}`)
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

  bot.action(/^list_(.+)_(\d+)$/, async (ctx) => {
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

      await ctx.answerCbQuery();
      const waitMsg = await ctx.reply("⏳ <i>Running manual check... please wait (this may take 10-15 seconds).</i>", { parse_mode: "HTML" });
      
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
      try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch(e){}
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

  bot.action(/^move_link_(.+)$/, async (ctx) => {
    const linkId = parseInt(ctx.match[1], 10);
    try {
      const folders = await prisma.folder.findMany({ where: { userId: ctx.dbUser.id }, orderBy: { id: 'asc' } });
      
      if (folders.length === 0) {
        return ctx.answerCbQuery("You have no folders. Create one using /folder create [Name]", { show_alert: true });
      }

      const buttons = folders.map(f => [Markup.button.callback(`📁 ${f.name}`, `assign_link_${linkId}_${f.id}`)]);
      buttons.push([Markup.button.callback("🗂️ Uncategorized (Remove)", `assign_link_${linkId}_null`)]);
      buttons.push([Markup.button.callback("🔙 Cancel", `view_link_${linkId}`)]);

      try { await ctx.deleteMessage(); } catch(e){}
      await ctx.reply(`<b>📁 Select a Folder for this link:</b>`, { 
        parse_mode: "HTML", 
        reply_markup: { inline_keyboard: buttons } 
      });
      ctx.answerCbQuery();
    } catch (error) {
      ctx.answerCbQuery("Error loading folders.", { show_alert: true });
    }
  });

  bot.action(/^assign_link_(.+)_([^]+)$/, async (ctx) => {
    const linkId = parseInt(ctx.match[1], 10);
    const folderIdRaw = ctx.match[2];
    
    try {
      const folderId = folderIdRaw === "null" ? null : parseInt(folderIdRaw, 10);
      await prisma.link.update({ where: { id: linkId, userId: ctx.dbUser.id }, data: { folderId } });
      await ctx.answerCbQuery("✅ Link moved successfully!");
      
      const panel = await generateControlPanel(linkId, ctx.dbUser.id);
      try { await ctx.deleteMessage(); } catch(e){}
      if (panel.photoUrl) {
        try { await ctx.replyWithPhoto(panel.photoUrl, { caption: panel.text, parse_mode: "HTML", ...panel.markup }); }
        catch (e) { await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup }); }
      } else {
        await ctx.reply(panel.text, { parse_mode: "HTML", disable_web_page_preview: true, ...panel.markup });
      }
    } catch (e) {
      ctx.answerCbQuery("❌ Error moving link.", { show_alert: true });
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

  const sendSupport = async (ctx) => {
    try {
      const contacts = await prisma.supportContact.findMany({ orderBy: { id: 'asc' } });
      let supportButtons = [];
      let row = [];
      for (const c of contacts) {
        row.push({ text: c.name, url: c.url });
        if (row.length === 2) {
          supportButtons.push(row);
          row = [];
        }
      }
      if (row.length > 0) supportButtons.push(row);
      if (supportButtons.length === 0) {
        supportButtons = [[{ text: "Contact Support", url: "https://t.me/adssupportz" }]];
      }
      ctx.reply("💬 <b>Need help?</b> Contact our support team below:", { 
        parse_mode: "HTML", 
        reply_markup: { inline_keyboard: supportButtons } 
      });
    } catch(e) {
      ctx.reply("❌ Error fetching support contacts.");
    }
  };

  bot.hears('📞 Contact Support', sendSupport);
  bot.command("contact", sendSupport);

  bot.command("start", async (ctx) => {
    try {
      await updateUserMenu(bot, ctx.from.id, ctx.dbUser.role);
      ctx.reply(
        `<b>👋 Welcome to the Agency Tracker!</b>\n${DIVIDER}\n` +
        `Your command menu has been updated based on your role (<b>${ctx.dbUser.role}</b>).\n\n` +
        `Click the blue <b>Menu</b> button next to the chat box to see your available commands!`,
        { parse_mode: "HTML", ...mainMenu }
      );
    } catch (e) {
      ctx.reply(`Menu Error: ${e.message}`);
    }
  });

  bot.command("syncmenu", async (ctx) => {
    try {
      await updateUserMenu(bot, ctx.from.id, ctx.dbUser.role);
      ctx.reply(`✅ Sync successful for role: ${ctx.dbUser.role}`);
    } catch (e) {
      ctx.reply(`❌ Sync failed: ${e.message}`);
    }
  });

  bot.command("help", (ctx) => {
    ctx.reply(
      `<b>🛠️ HOW TO USE</b>\n${DIVIDER}\n` +
        "Simply paste a social media link into this chat and the bot will immediately start monitoring it.\n\n" +
        "Use the buttons on your keyboard to navigate the dashboard. Tap <b>📋 My Links</b> to view, check, and manage your profiles.",
      { parse_mode: "HTML", ...mainMenu }
    );
  });

  bot.command("folder", async (ctx) => {
    const text = ctx.message.text.replace("/folder", "").trim();
    if (!text) {
      return ctx.reply("⚠️ <b>Folder Commands:</b>\n\n<code>/folder list</code>\n<code>/folder create [Name]</code>\n<code>/folder delete [ID]</code>", { parse_mode: "HTML" });
    }

    if (text === "list") {
      const folders = await prisma.folder.findMany({ where: { userId: ctx.dbUser.id }, orderBy: { id: 'asc' }, include: { _count: { select: { links: true } } } });
      if (folders.length === 0) return ctx.reply("You have no folders.");
      let msg = `<b>📁 Your Folders</b>\n${DIVIDER}\n`;
      folders.forEach(f => {
        msg += `<b>ID:</b> ${f.id} | <b>Name:</b> ${f.name} (${f._count.links} links)\n`;
      });
      return ctx.reply(msg, { parse_mode: "HTML" });
    }

    if (text.startsWith("create")) {
      const name = text.replace("create", "").trim();
      if (!name) return ctx.reply("⚠️ Usage: <code>/folder create Client Nike</code>", { parse_mode: "HTML" });
      try {
        await prisma.folder.create({ data: { userId: ctx.dbUser.id, name } });
        return ctx.reply(`✅ <b>Folder Created:</b> ${name}`, { parse_mode: "HTML" });
      } catch (e) {
        return ctx.reply("❌ Error creating folder.");
      }
    }

    if (text.startsWith("delete")) {
      const parts = text.split(" ");
      const id = parseInt(parts[1], 10);
      if (!id) return ctx.reply("⚠️ Usage: <code>/folder delete [ID]</code>", { parse_mode: "HTML" });
      try {
        const folder = await prisma.folder.findFirst({ where: { id, userId: ctx.dbUser.id } });
        if (!folder) return ctx.reply("❌ Folder not found.");
        await prisma.folder.delete({ where: { id } });
        return ctx.reply(`✅ Folder deleted. Links inside are now uncategorized.`);
      } catch (e) {
        return ctx.reply("❌ Error deleting folder.");
      }
    }
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

  // Admin Management Commands
  bot.command("users", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    try {
      const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
      let msg = `<b>👥 DATABASE USERS</b>\n${DIVIDER}\n`;
      users.forEach(u => {
        msg += `<b>ID:</b> ${u.id} | <b>Role:</b> ${u.role}\n`;
        msg += `<b>Name:</b> ${u.firstName || ''} ${u.lastName || ''} (@${u.username || 'none'})\n`;
        msg += `<b>License:</b> ${u.licenseExpiresAt ? new Date(u.licenseExpiresAt).toLocaleDateString() : 'Expired'}\n\n`;
      });
      ctx.reply(msg, { parse_mode: "HTML" });
    } catch (e) {
      ctx.reply("❌ Error fetching users.");
    }
  });

  bot.command("support", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    
    const text = ctx.message.text.replace("/support", "").trim();
    if (!text) {
      return ctx.reply("⚠️ <b>Usage:</b>\n\n<code>/support add [Name] | [URL]</code>\n<code>/support remove [ID]</code>\n<code>/support list</code>", { parse_mode: "HTML" });
    }

    if (text === "list") {
      const contacts = await prisma.supportContact.findMany({ orderBy: { id: 'asc' } });
      if (contacts.length === 0) return ctx.reply("No support contacts found.");
      let msg = `<b>📞 Support Contacts</b>\n${DIVIDER}\n`;
      contacts.forEach(c => {
        msg += `<b>ID:</b> ${c.id}\n<b>Name:</b> ${c.name}\n<b>URL:</b> ${c.url}\n\n`;
      });
      return ctx.reply(msg, { parse_mode: "HTML", disable_web_page_preview: true });
    }

    if (text.startsWith("remove")) {
      const parts = text.split(" ");
      const idToRemove = parseInt(parts[1], 10);
      if (!idToRemove) return ctx.reply("⚠️ Usage: <code>/support remove [ID]</code>", { parse_mode: "HTML" });
      try {
        await prisma.supportContact.delete({ where: { id: idToRemove } });
        return ctx.reply(`✅ Successfully removed contact #${idToRemove}`);
      } catch(e) {
        return ctx.reply("❌ Failed to remove contact. Ensure ID is correct.");
      }
    }

    if (text.startsWith("add")) {
      const content = text.replace("add", "").trim();
      const parts = content.split("|").map(s => s.trim());
      if (parts.length % 2 !== 0 || parts.length === 0) return ctx.reply("⚠️ Usage: <code>/support add Contact Sales | https://t.me/adssupportz</code>", { parse_mode: "HTML" });
      try {
        for (let i = 0; i < parts.length; i += 2) {
          if (parts[i] && parts[i+1]) {
            await prisma.supportContact.create({
              data: { name: parts[i], url: parts[i+1] }
            });
          }
        }
        return ctx.reply("✅ <b>Success!</b> Support contact(s) added.", { parse_mode: "HTML" });
      } catch(e) {
        return ctx.reply(`❌ Failed to add support contact. Error: ${e.message}`);
      }
    }
  });

  bot.command("setpaywall", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    const messageText = ctx.message.text.replace("/setpaywall", "").trim();
    if (!messageText) {
      return ctx.reply("⚠️ Please provide the message you want to set for the paywall.\nExample: <code>/setpaywall 🔒 Access Denied! Please purchase a key below to continue.</code>", { parse_mode: "HTML" });
    }

    try {
      await prisma.systemConfig.upsert({
        where: { key: "PAYWALL_MESSAGE" },
        update: { value: messageText },
        create: { key: "PAYWALL_MESSAGE", value: messageText }
      });
      ctx.reply(`✅ <b>Paywall Message Updated!</b>\n\nRun /viewpaywall to see exactly how it looks to your clients.`, { parse_mode: "HTML" });
    } catch (e) {
      logger.error(`Error saving paywall message: ${e.message}`);
      ctx.reply("❌ Failed to save the custom paywall message.");
    }
  });

  bot.command("viewpaywall", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    try {
      const config = await prisma.systemConfig.findUnique({ where: { key: "PAYWALL_MESSAGE" } });
      const message = config ? config.value : `🔒 <b>Your license has expired.</b>\n\nPlease enter a valid License Key to continue using the bot. (e.g. AGENCY-XYZ123)\n\n💬 <b>Need a key?</b> Contact our support team below to purchase access.`;
      
      let supportButtons = [];
      const contacts = await prisma.supportContact.findMany({ orderBy: { id: 'asc' } });
      supportButtons = contacts.map(c => [{ text: c.name, url: c.url }]);
      if (supportButtons.length === 0) {
        supportButtons = [[{ text: "🛒 Contact Support to Buy Key", url: "https://t.me/adssupportz" }]];
      }

      ctx.reply(message, { parse_mode: "HTML", reply_markup: { inline_keyboard: supportButtons } });
    } catch (e) {
      ctx.reply("❌ Failed to fetch the paywall message.");
    }
  });

  bot.command("promote", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    const parts = ctx.message.text.split(" ");
    const targetId = parseInt(parts[1], 10);
    if (!targetId || isNaN(targetId)) return ctx.reply("⚠️ Usage: <code>/promote [UserID] [Optional: SUPER_ADMIN]</code>\nExample: <code>/promote 2</code> or <code>/promote 2 SUPER_ADMIN</code>", { parse_mode: "HTML" });

    let targetRole = "ADMIN";
    if (parts[2] && parts[2].toUpperCase() === "SUPER_ADMIN") {
      targetRole = "SUPER_ADMIN";
    }

    try {
      await prisma.user.update({
        where: { id: targetId },
        data: { role: targetRole, licenseExpiresAt: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000) }
      });
      const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
      await updateUserMenu(bot, parseInt(targetUser.telegramId, 10), targetRole);
      ctx.reply(`✅ <b>Success!</b>\nUser #${targetId} is now a(n) ${targetRole}.`, { parse_mode: "HTML" });
    } catch (e) {
      ctx.reply("❌ Error promoting user. Check if ID exists.");
    }
  });

  bot.command("demote", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    const parts = ctx.message.text.split(" ");
    const targetId = parseInt(parts[1], 10);
    if (!targetId || isNaN(targetId)) return ctx.reply("⚠️ Usage: <code>/demote [UserID]</code>", { parse_mode: "HTML" });

    try {
      await prisma.user.update({
        where: { id: targetId },
        data: { role: "USER", licenseExpiresAt: new Date() } // instantly expire license
      });
      const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
      await updateUserMenu(bot, parseInt(targetUser.telegramId, 10), "USER");
      ctx.reply(`✅ <b>Success!</b>\nUser #${targetId} has been demoted to USER and their license is expired.`, { parse_mode: "HTML" });
    } catch (e) {
      ctx.reply("❌ Error demoting user. Check if ID exists.");
    }
  });

  bot.command("broadcast", async (ctx) => {
    if (ctx.dbUser.role !== "SUPER_ADMIN") return;
    
    const rawText = ctx.message.text.replace("/broadcast", "").trim();
    if (!rawText) {
      return ctx.reply("⚠️ Usage:\n<code>/broadcast [Message]\n===\n[Button text] | [URL]</code>", { parse_mode: "HTML" });
    }

    let messageText = rawText;
    let buttons = [];

    if (rawText.includes("===")) {
      const parts = rawText.split("===");
      messageText = parts[0].trim();
      const buttonLines = parts[1].trim().split("\n");
      
      buttonLines.forEach(line => {
        if (!line.trim()) return;
        const btnParts = line.split("|").map(s => s.trim());
        let row = [];
        for (let i = 0; i < btnParts.length; i += 2) {
          if (btnParts[i] && btnParts[i+1]) {
            row.push({ text: btnParts[i], url: btnParts[i+1] });
          }
        }
        if (row.length > 0) {
          buttons.push(row);
        }
      });
    }

    try {
      const users = await prisma.user.findMany();
      let successCount = 0;
      
      const sendOptions = { parse_mode: "HTML", disable_web_page_preview: true };
      if (buttons.length > 0) {
        sendOptions.reply_markup = { inline_keyboard: buttons };
      }

      await ctx.reply(`⏳ <b>Broadcast started...</b> Sending to ${users.length} users.`, { parse_mode: "HTML" });

      for (const user of users) {
        try {
          await ctx.telegram.sendMessage(user.telegramId, `📢 <b>ADMIN ANNOUNCEMENT</b>\n\n${messageText}`, sendOptions);
          successCount++;
        } catch (e) {
          logger.error(`Failed to broadcast to ${user.telegramId}: ${e.message}`);
        }
      }
      ctx.reply(`✅ <b>Broadcast Complete!</b>\nSuccessfully sent to ${successCount} users.`, { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Error in broadcast: ${error.message}`);
      ctx.reply("❌ Failed to send broadcast.");
    }
  });

  // Admin GenKey Command
  bot.command("genkey", async (ctx) => {
    if (ctx.dbUser.role !== "ADMIN" && ctx.dbUser.role !== "SUPER_ADMIN") return;

    const parts = ctx.message.text.split(" ");
    const days = parseInt(parts[1], 10);
    if (!days || isNaN(days)) {
      return ctx.reply("⚠️ Usage: <code>/genkey [days]</code>\nExample: <code>/genkey 30</code>", { parse_mode: "HTML" });
    }

    const randomStr = Math.random().toString(36).substring(2, 10).toUpperCase();
    const keyString = `AGENCY-${days}D-${randomStr}`;

    try {
      await prisma.licenseKey.create({
        data: {
          key: keyString,
          durationDays: days
        }
      });
      ctx.reply(`✅ <b>License Key Generated!</b>\n\nDuration: ${days} Days\nKey: <code>${keyString}</code>`, { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Error generating key: ${error.message}`);
      ctx.reply("❌ Failed to generate key.");
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

    // Handle License Key Redemption
    if (text.startsWith("AGENCY-")) {
      try {
        const license = await prisma.licenseKey.findUnique({ where: { key: text } });
        if (!license) return ctx.reply("❌ Invalid License Key.");
        if (license.isUsed) return ctx.reply("❌ This License Key has already been used.");

        const now = new Date();
        const currentExpiry = ctx.dbUser.licenseExpiresAt && ctx.dbUser.licenseExpiresAt > now ? ctx.dbUser.licenseExpiresAt : now;
        const newExpiry = new Date(currentExpiry.getTime() + license.durationDays * 24 * 60 * 60 * 1000);

        await prisma.$transaction([
          prisma.licenseKey.update({
            where: { id: license.id },
            data: { isUsed: true, usedByUserId: ctx.dbUser.id, usedAt: now }
          }),
          prisma.user.update({
            where: { id: ctx.dbUser.id },
            data: { licenseExpiresAt: newExpiry }
          })
        ]);

        return ctx.reply(`🎉 <b>License Activated!</b>\n\nYour subscription has been extended by ${license.durationDays} days.\n<b>Expires:</b> ${newExpiry.toDateString()}`, { parse_mode: "HTML", ...mainMenu });
      } catch (error) {
        logger.error(`Error redeeming key: ${error.message}`);
        return ctx.reply("❌ An error occurred while redeeming your key.");
      }
    }

    if (isValidUrl(text)) {
      await handleAddLink(ctx, text);
    } else if (/^\d+$/.test(text)) {
      // If the user sends just numbers, assume it's a Facebook UID
      const fbUrl = `https://facebook.com/${text}`;
      await handleAddLink(ctx, fbUrl);
    }
  });
};
