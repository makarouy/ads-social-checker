import express from "express";
import apiRoutes from "./routes/api.js";
import { logger } from "./utils/logger.js";

const app = express();

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`Incoming request: ${req.method} ${req.url}`);
  next();
});

app.use("/api", apiRoutes);

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Express Error: ${err.message}`);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;
