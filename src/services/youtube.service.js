import axios from "axios";
import { logger } from "../utils/logger.js";

export const checkYouTubeStatus = async (url) => {
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
        lowerData.includes("this video is private") ||
        lowerData.includes("private video")
      ) {
        return "PRIVATE";
      }
      if (
        lowerData.includes("this video is unavailable") ||
        lowerData.includes("this video has been removed") ||
        lowerData.includes("this channel does not exist")
      ) {
        return "NOT_FOUND";
      }
      if (lowerData.includes("this account has been suspended")) {
        return "SUSPENDED";
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
    logger.error(`YouTube check error for ${url}: ${error.message}`);
    return "UNKNOWN";
  }
};
