import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
const pino = (pinoHttp as any);
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app = express();

const isProduction = process.env.NODE_ENV === "production";

// CORS — restrict in production, allow local dev origins otherwise
const corsOrigin = process.env.CORS_ORIGIN;

if (isProduction && !corsOrigin) {
  logger.warn("CORS_ORIGIN is not set in production. CORS will be restricted to the request origin.");
}

app.use(
  cors({
    origin: corsOrigin ? corsOrigin.split(",") : true,
    credentials: true,
  }),
);

// General rate limiter — 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req: any, res: any) {
    res.status(429).json({
      error: "Too many requests, please try again later.",
    });
  },
});

app.use(generalLimiter);

app.use(
  pino({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },

      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;