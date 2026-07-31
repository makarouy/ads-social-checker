import { Router } from "express";
import prisma from "../database/client.js";
import { checkLinkStatus, detectPlatform } from "../checkers/statusChecker.js";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

router.get("/links", async (req, res) => {
  try {
    const links = await prisma.link.findMany();
    res.json({ data: links });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/links", async (req, res) => {
  const { userId, url } = req.body;
  if (!userId || !url) {
    return res.status(400).json({ error: "Missing userId or url" });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({ error: "Unsupported platform" });
  }

  try {
    const currentStatus = await checkLinkStatus(platform, url);
    const link = await prisma.link.create({
      data: {
        userId,
        platform,
        url,
        currentStatus,
        lastChecked: new Date(),
      },
    });
    res.status(201).json({ data: link });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/links/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.link.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/check", async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "Missing link id" });
  }

  try {
    const link = await prisma.link.findUnique({ where: { id: Number(id) } });
    if (!link) {
      return res.status(404).json({ error: "Link not found" });
    }

    const newStatus = await checkLinkStatus(link.platform, link.url);
    res.json({ data: { url: link.url, status: newStatus } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
