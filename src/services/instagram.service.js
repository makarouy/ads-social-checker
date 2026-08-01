import axios from "axios";
import { logger } from "../utils/logger.js";

export const checkInstagramStatus = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    const { status, data } = response;
    const lowerData = typeof data === "string" ? data.toLowerCase() : "";

    if (status === 200) {
      if (lowerData.includes("login") && !lowerData.includes("profile picture")) {
        return { status: "LOGIN_REQUIRED", followerCount: null };
      }
      if (lowerData.includes("page not found") || lowerData.includes("sorry, this page isn't available")) {
        return { status: "NOT_FOUND", followerCount: null };
      }

      let followerCount = null;
      // Instagram meta description usually looks like: "1.2M Followers, 100 Following, 500 Posts..."
      const match = data.match(/([\d,MK.]+)\s+Followers/i);
      if (match && match[1]) {
        followerCount = match[1];
      }

      return { status: "LIVE", followerCount };
    }

    if (status === 404) {
      return { status: "NOT_FOUND", followerCount: null };
    }

    if (status === 429) {
      return { status: "RATE_LIMITED", followerCount: null };
    }

    return { status: "UNKNOWN", followerCount: null };
  } catch (error) {
    logger.error(`Instagram check error for ${url}: ${error.message}`);
    return { status: "UNKNOWN", followerCount: null };
  }
};
