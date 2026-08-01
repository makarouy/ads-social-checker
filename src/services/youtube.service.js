import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "../utils/logger.js";

export const checkYouTubeStatus = async (url) => {
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
        lowerData.includes("this video is private") ||
        lowerData.includes("private video")
      ) {
        return { status: "PRIVATE", followerCount: null };
      }
      if (
        lowerData.includes("this video is unavailable") ||
        lowerData.includes("this video has been removed") ||
        lowerData.includes("this channel does not exist")
      ) {
        return { status: "NOT_FOUND", followerCount: null };
      }
      if (lowerData.includes("this account has been suspended")) {
        return { status: "SUSPENDED", followerCount: null };
      }

      let followerCount = null;
      // Search for "1.2M subscribers" in the page source
      const match = data.match(/([\d,MK.]+)\s+subscribers/i);
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
    logger.error(`YouTube check error for ${url}: ${error.message}`);
    return { status: "UNKNOWN", followerCount: null };
  }
};
