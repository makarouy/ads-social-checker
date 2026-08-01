import prisma from "../database/client.js";
import { logger } from "../utils/logger.js";

export const runWeeklySummary = async (bot) => {
  logger.info("Starting Weekly Summary broadcast...");
  
  try {
    // Only send to users who have an active license (or ADMINs)
    const now = new Date();
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { role: "ADMIN" },
          { licenseExpiresAt: { gt: now } }
        ]
      },
      include: {
        links: {
          where: { isArchived: false }
        }
      }
    });

    // 7 days ago
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    for (const user of users) {
      if (user.links.length === 0) continue; // Skip if they aren't tracking anything

      let totalLinks = user.links.length;
      let liveLinks = 0;
      let deadLinks = 0;

      for (const link of user.links) {
        if (link.currentStatus === "LIVE") liveLinks++;
        else deadLinks++;
      }

      // Find how many links were recovered this week
      // A link is considered "recovered" this week if it went from DEAD to LIVE in the last 7 days.
      const recentHistories = await prisma.history.findMany({
        where: {
          link: { userId: user.id },
          checkedAt: { gte: oneWeekAgo },
          status: "LIVE"
        }
      });
      
      // Filter out duplicate link IDs to count unique recoveries
      const recoveredLinkIds = new Set(recentHistories.map(h => h.linkId));
      const recoveredCount = recoveredLinkIds.size;

      const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";
      let message = `<b>📅 WEEKLY AGENCY SUMMARY</b>\n${DIVIDER}\n`;
      message += `<b>Total Accounts Tracked:</b> ${totalLinks}\n`;
      message += `🟢 <b>Currently LIVE:</b> ${liveLinks}\n`;
      message += `🔴 <b>Currently DOWN:</b> ${deadLinks}\n\n`;
      message += `🔥 <b>Recovered This Week:</b> ${recoveredCount} accounts!\n`;
      message += `${DIVIDER}\n`;
      message += `<i>Great work! Keep monitoring your dashboard to maximize client retention.</i>`;

      try {
        await bot.telegram.sendMessage(user.telegramId, message, { parse_mode: "HTML" });
      } catch (err) {
        logger.error(`Failed to send weekly summary to ${user.telegramId}: ${err.message}`);
      }
    }
    
    logger.info("Finished Weekly Summary broadcast.");
  } catch (error) {
    logger.error(`Error in Weekly Summary: ${error.message}`);
  }
};
