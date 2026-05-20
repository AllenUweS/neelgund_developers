import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Patch request path for Express routing under /api
  if (!req.url?.startsWith("/api")) {
    req.url = `/api${req.url}`;
  }
  return app(req, res);
}
