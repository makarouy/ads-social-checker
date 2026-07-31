import { checkFacebookStatus } from "../services/facebook.service.js";
import { checkInstagramStatus } from "../services/instagram.service.js";
import { checkTikTokStatus } from "../services/tiktok.service.js";
import { checkYouTubeStatus } from "../services/youtube.service.js";
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
  switch (platform) {
    case "Facebook":
      return await checkFacebookStatus(url);
    case "Instagram":
      return await checkInstagramStatus(url);
    case "TikTok":
      return await checkTikTokStatus(url);
    case "YouTube":
      return await checkYouTubeStatus(url);
    default:
      return "UNKNOWN";
  }
};

export const runGlobalCheck = async (bot) => {
  logger.info("Starting global status check...");
  try {
    const links = await prisma.link.findMany({
      include: { user: true, histories: true },
    });

    for (const link of links) {
      const newStatus = await checkLinkStatus(link.platform, link.url);
      const now = new Date();

      if (newStatus !== link.currentStatus && newStatus !== "UNKNOWN") {
        logger.info(
          `Status changed for ${link.url}: ${link.currentStatus} -> ${newStatus}`
        );

        // Save history
        await prisma.history.create({
          data: {
            linkId: link.id,
            status: newStatus,
          },
        });

        // Update Link
        await prisma.link.update({
          where: { id: link.id },
          data: {
            lastStatus: link.currentStatus,
            currentStatus: newStatus,
            lastChecked: now,
            lastChanged: now,
          },
        });

        // Notify user
        const message = `🚨 *Status Changed*\n\n*Platform:* ${link.platform}\n*Old Status:* ${link.currentStatus}\n*New Status:* ${newStatus}\n*URL:* ${link.url}\n*Time:* ${now.toISOString().replace('T', ' ').substring(0, 16)}`;
        
        try {
          await bot.telegram.sendMessage(link.user.telegramId, message, {
            parse_mode: "Markdown",
          });
          
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
