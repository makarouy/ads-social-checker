import { checkFacebookStatus } from "../services/facebook.service.js";
import { checkInstagramStatus } from "../services/instagram.service.js";
import { checkTikTokStatus } from "../services/tiktok.service.js";
import { checkYouTubeStatus } from "../services/youtube.service.js";
import { getStatusEmoji, formatCambodiaTime } from "../utils/formatters.js";
import { logger } from "../utils/logger.js";
import prisma from "../database/client.js";

// Utility to determine platform
export const detectPlatform = (url) => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("facebook.com") || lowerUrl.includes("fb.com"))
    return "Facebook";
  if (lowerUrl.includes("instagram.com")) return "Instagram";
  if (lowerUrl.includes("tiktok.com")) return "TikTok";
  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be"))
    return "YouTube";
  return null;
};

export const checkLinkStatus = async (platform, url) => {
  let result;
  switch (platform) {
    case "Facebook":
      result = await checkFacebookStatus(url);
      break;
    case "Instagram":
      result = await checkInstagramStatus(url);
      break;
    case "TikTok":
      result = await checkTikTokStatus(url);
      break;
    case "YouTube":
      result = await checkYouTubeStatus(url);
      break;
    default:
      result = "UNKNOWN";
  }
  
  if (typeof result === "string") {
    return { status: result, name: null, photoUrl: null };
  }
  return result;
};

export const runGlobalCheck = async (bot) => {
  logger.info("Starting global status check...");
  try {
    const links = await prisma.link.findMany({
      include: { user: true, histories: true },
    });

    for (const link of links) {
      const { status: newStatus, name: newName, photoUrl: newPhotoUrl } = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      let statusChanged = newStatus !== link.currentStatus && newStatus !== "UNKNOWN";
      let nameChanged = newName && newName !== link.name;
      let photoChanged = newPhotoUrl && newPhotoUrl !== link.photoUrl;

      if (statusChanged || nameChanged || photoChanged) {
        logger.info(
          `Updates detected for ${link.url}: Status(${link.currentStatus}->${newStatus}), Name(${link.name}->${newName})`
        );

        if (statusChanged) {
          // Save history
          await prisma.history.create({
            data: {
              linkId: link.id,
              status: newStatus,
            },
          });
        }

        // Update Link
        await prisma.link.update({
          where: { id: link.id },
          data: {
            ...(statusChanged && { lastStatus: link.currentStatus, currentStatus: newStatus, lastChanged: now }),
            ...(nameChanged && { name: newName }),
            ...(photoChanged && { photoUrl: newPhotoUrl }),
            lastChecked: now,
          },
        });

        // Notify user
        const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";
        let message = `<b>🔔 ALERT: STATUS CHANGE</b>\n${DIVIDER}\n`;
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
        
        try {
          if (photoChanged && newPhotoUrl) {
            try {
              await bot.telegram.sendPhoto(link.user.telegramId, newPhotoUrl, {
                caption: message,
                parse_mode: "HTML",
              });
            } catch (photoError) {
              logger.error(`Global check: Failed to send photo: ${photoError.message}`);
              await bot.telegram.sendMessage(link.user.telegramId, message, {
                parse_mode: "HTML",
                disable_web_page_preview: true
              });
            }
          } else {
            await bot.telegram.sendMessage(link.user.telegramId, message, {
              parse_mode: "HTML",
              disable_web_page_preview: true
            });
          }
          
          await prisma.notification.create({
            data: {
              userId: link.userId,
              message: message,
            },
          });
        } catch (err) {
          logger.error(`Failed to send Telegram notification to ${link.user.telegramId}: ${err.message}`);
        }
      } else {
        // Just update lastChecked
        await prisma.link.update({
          where: { id: link.id },
          data: { lastChecked: now },
        });
      }
    }
  } catch (error) {
    logger.error(`Global check error: ${error.message}`);
  }
  logger.info("Finished global status check.");
};
