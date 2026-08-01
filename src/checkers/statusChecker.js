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
    return { status: result, name: null, photoUrl: null, followerCount: null };
  }
  return result;
};

export const runGlobalCheck = async (bot) => {
  logger.info("Starting global status check...");
  try {
    const links = await prisma.link.findMany({
      where: {
        isArchived: false
      },
      include: { user: true, histories: true },
    });

    for (const link of links) {
      const { status: newStatus, name: newName, photoUrl: newPhotoUrl, followerCount: newFollowers } = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      let statusChanged = newStatus !== link.currentStatus && newStatus !== "UNKNOWN";
      let nameChanged = newName && newName !== link.name;
      let photoChanged = newPhotoUrl && newPhotoUrl !== link.photoUrl;
      let followersChanged = newFollowers && newFollowers !== link.followerCount;

      if (statusChanged || nameChanged || photoChanged || followersChanged) {
        logger.info(
          `Updates detected for ${link.url}: Status(${link.currentStatus}->${newStatus})`
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
            ...(followersChanged && { followerCount: newFollowers }),
            lastChecked: now,
          },
        });

        // Notify user if not muted
        if (!link.isMuted) {
          const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";
          let message = `<b>🔔 ALERT: STATUS CHANGE</b>\n${DIVIDER}\n`;
          message += `<b>Platform:</b> ${link.platform}\n`;
          message += `<b>Account:</b> ${newName || link.name || "N/A"}\n`;
          if (newFollowers || link.followerCount) {
            message += `<b>Followers:</b> ${newFollowers || link.followerCount} 📈\n`;
          }
          message += `\n`;
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
            // Helper function to send message/photo to a specific ID
            const sendAlertToId = async (targetId) => {
              if (photoChanged && newPhotoUrl) {
                try {
                  await bot.telegram.sendPhoto(targetId, newPhotoUrl, {
                    caption: message,
                    parse_mode: "HTML",
                  });
                } catch (photoError) {
                  logger.error(`Global check: Failed to send photo to ${targetId}: ${photoError.message}`);
                  await bot.telegram.sendMessage(targetId, message, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true
                  });
                }
              } else {
                await bot.telegram.sendMessage(targetId, message, {
                  parse_mode: "HTML",
                  disable_web_page_preview: true
                });
              }
            };

            // Send to the user who added it
            await sendAlertToId(link.user.telegramId);

            // Broadcast to Group Chat if configured
            if (process.env.GROUP_CHAT_ID) {
              try {
                await sendAlertToId(process.env.GROUP_CHAT_ID);
              } catch (groupErr) {
                logger.error(`Failed to broadcast to GROUP_CHAT_ID: ${groupErr.message}`);
              }
            }
            
            await prisma.notification.create({
              data: {
                userId: link.userId,
                message: message,
              },
            });
          } catch (err) {
            logger.error(`Failed to process Telegram notifications for ${link.user.telegramId}: ${err.message}`);
          }
        } else {
          logger.info(`Skipped alert for ${link.url} because it is MUTED.`);
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
