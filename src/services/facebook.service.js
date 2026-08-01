import { chromium } from "playwright";
import { logger } from "../utils/logger.js";

export const checkFacebookStatus = async (url) => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Use a 15-second timeout so it doesn't hang forever
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const status = response ? response.status() : 0;

    const html = await page.content();
    const lowerData = html.toLowerCase();

    let name = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content", { timeout: 2000 })
      .catch(() => null);

    let photoUrl = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content", { timeout: 2000 })
      .catch(() => null);

    if (name && name.endsWith(" | Facebook")) {
      name = name.replace(" | Facebook", "");
    }

    if (status === 200 || status === 304 || status === 302 || status === 301) {
      if (
        lowerData.includes("you must log in to continue") ||
        lowerData.includes("login_required")
      ) {
        return { status: "LOGIN_REQUIRED", name: null, photoUrl: null };
      }
      if (
        lowerData.includes("this content isn't available right now") ||
        lowerData.includes("page not found") ||
        lowerData.includes("doesn't exist")
      ) {
        return { status: "NOT_FOUND", name, photoUrl };
      }

      // If Facebook shows a generic login wall, the title is usually "Log in or sign up"
      if (name && (name.includes("Log In") || name.includes("Log in"))) {
        return { status: "LOGIN_REQUIRED", name: null, photoUrl: null };
      }

      // If we got the photo and name, we bypass UNKNOWN even if status was weird
      if (photoUrl && name) {
        return { status: "LIVE", name, photoUrl };
      }

      return { status: "LIVE", name, photoUrl };
    }

    if (status === 404) {
      return { status: "NOT_FOUND", name, photoUrl };
    }

    if (status === 429) {
      return { status: "RATE_LIMITED", name, photoUrl };
    }

    // Sometimes Facebook returns 403 (Forbidden) to cloud servers even via Playwright,
    // but the page still loads a CAPTCHA or a login redirect.
    // If we managed to get a photoUrl, it's actually live.
    if (photoUrl && name && !name.includes("Log In")) {
      return { status: "LIVE", name, photoUrl };
    }

    logger.warn(`Unexpected Facebook status for ${url}: ${status}`);
    return { status: "UNKNOWN", name, photoUrl };
  } catch (error) {
    logger.error(`Facebook Playwright check error for ${url}: ${error.message}`);
    return { status: "UNKNOWN", name: null, photoUrl: null };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};
