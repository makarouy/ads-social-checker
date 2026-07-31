import prisma from "../database/client.js";
import { logger } from "../utils/logger.js";

// Rate limiting map (in-memory, simplified)
const userRequests = new Map();

export const rateLimit = (ctx, next) => {
  const userId = ctx.from.id;
  const now = Date.now();
  const limitWindow = 1000; // 1 request per second

  if (userRequests.has(userId)) {
    const lastRequest = userRequests.get(userId);
    if (now - lastRequest < limitWindow) {
      return ctx.reply("Please slow down. You are sending requests too fast.");
    }
  }

  userRequests.set(userId, now);
  return next();
};

export const registerUser = async (ctx, next) => {
  if (!ctx.from) return next();

  const { id, username, first_name, last_name } = ctx.from;

  try {
    let user = await prisma.user.findUnique({
      where: { telegramId: id.toString() },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: id.toString(),
          username: username || null,
          firstName: first_name || null,
          lastName: last_name || null,
          settings: {
            create: {}, // Create default settings
          },
        },
      });
      logger.info(`New user registered: ${id}`);
    }
    
    // Inject user into context for downstream commands
    ctx.dbUser = user;
    return next();
  } catch (error) {
    logger.error(`Error registering user: ${error.message}`);
    return ctx.reply("An error occurred while processing your user profile.");
  }
};
