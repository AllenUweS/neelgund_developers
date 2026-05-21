import app from "../src/app.js";

export default function handler(req: any, res: any) {
  if (!req.url?.startsWith("/api")) {
    req.url = `/api${req.url}`;
  }

  return app(req, res);
}