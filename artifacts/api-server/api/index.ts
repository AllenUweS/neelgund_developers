import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app.js";

export default (req: VercelRequest, res: VercelResponse) => {
  if (!req.url?.startsWith("/api")) {
    req.url = `/api${req.url}`;
  }

  return (app as any)(req, res);
};