import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "../utils/logger.js";

export const checkTikTokStatus = async (url) => {
  try {
    const axiosConfig = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 10000,
      validateStatus: () => true,
    };

    if (process.env.PROXY_URL) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
    }

    const response = await axios.get(url, axiosConfig);

    const { status, data } = response;
    const lowerData = typeof data === "string" ? data.toLowerCase() : "";

    if (status === 200) {
      if (
        lowerData.includes("couldn't find this account") ||
        lowerData.includes("not found")
      ) {
        return { status: "NOT_FOUND", followerCount: null };
      }

      let followerCount = null;
      // Try meta description: "X Followers, Y Following, Z Likes"
      const match = data.match(/([\d,MK.]+)\s+Followers/i);
      if (match && match[1]) {
        followerCount = match[1];
      } else {
        // Fallback: search for followerCount in JSON data
        const jsonMatch = data.match(/"followerCount":\s*(\d+)/);
        if (jsonMatch && jsonMatch[1]) {
          let num = parseInt(jsonMatch[1], 10);
          if (num >= 1000000) followerCount = (num / 1000000).toFixed(1) + "M";
          else if (num >= 1000) followerCount = (num / 1000).toFixed(1) + "K";
          else followerCount = num.toString();
        }
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
    logger.error(`TikTok check error for ${url}: ${error.message}`);
    return { status: "UNKNOWN", followerCount: null };
  }
};
