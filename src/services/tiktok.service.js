import axios from "axios";
import { logger } from "../utils/logger.js";

export const checkTikTokStatus = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    const { status, data } = response;
    const lowerData = typeof data === "string" ? data.toLowerCase() : "";

    if (status === 200) {
      if (
        lowerData.includes("couldn't find this account") ||
        lowerData.includes("not found")
      ) {
        return "NOT_FOUND";
      }
      return "LIVE";
    }

    if (status === 404) {
      return "NOT_FOUND";
    }

    if (status === 429) {
      return "RATE_LIMITED";
    }

    return "UNKNOWN";
  } catch (error) {
    logger.error(`TikTok check error for ${url}: ${error.message}`);
    return "UNKNOWN";
  }
};
