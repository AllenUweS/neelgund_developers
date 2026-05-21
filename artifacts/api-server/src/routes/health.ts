// import { Router, type IRouter } from "express";
// import { HealthCheckResponse } from "@workspace/api-zod";

// const router: IRouter = Router();

// router.get("/healthz", (_req, res) => {
//   const data = HealthCheckResponse.parse({ status: "ok" });
//   res.json(data);
// });

// export default router;


import express from "express";

const router = express.Router();

router.get("/health", (_req: any, res: any) => {
  return res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;