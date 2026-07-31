import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";

export const checkFacebookStatus = async (url) => {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 10000,
      validateStatus: () => true, // resolve on all status codes
    });

    const { status, data } = response;
    const lowerData = typeof data === "string" ? data.toLowerCase() : "";

    let name = null;
    let photoUrl = null;

    if (typeof data === "string") {
      const $ = cheerio.load(data);
      name = $('meta[property="og:title"]').attr("content") || null;
      photoUrl = $('meta[property="og:image"]').attr("content") || null;
      
      // Clean up common " | Facebook" trailing text in name
      if (name && name.endsWith(" | Facebook")) {
        name = name.replace(" | Facebook", "");
      }
    }

    if (status === 200) {
      if (
        lowerData.includes("you must log in to continue") ||
        lowerData.includes("login_required")
      ) {
        return { status: "LOGIN_REQUIRED", name, photoUrl };
      }
      if (
        lowerData.includes("this content isn't available right now") ||
        lowerData.includes("page not found")
      ) {
        return { status: "NOT_FOUND", name, photoUrl };
      }
      return { status: "LIVE", name, photoUrl };
    }

    if (status === 404) {
      return { status: "NOT_FOUND", name, photoUrl };
    }

    if (status === 429) {
      return { status: "RATE_LIMITED", name, photoUrl };
    }

    return { status: "UNKNOWN", name, photoUrl };
  } catch (error) {
    logger.error(`Facebook check error for ${url}: ${error.message}`);
    return { status: "UNKNOWN", name: null, photoUrl: null };
  }
};
