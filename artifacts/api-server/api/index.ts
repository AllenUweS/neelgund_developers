// import type { VercelRequest, VercelResponse } from "@vercel/node";
// // import app from "../src/app";
// import app from "../src/app.js"

// export default async function handler(req: VercelRequest, res: VercelResponse) {
//   // Patch request path for Express routing under /api
//   if (!req.url?.startsWith("/api")) {
//     req.url = `/api${req.url}`;
//   }
//   return app(req, res);
// }

import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!req.url?.startsWith("/api")) {
    req.url = `/api${req.url}`;
  }

  return app.handle(req, res);
}