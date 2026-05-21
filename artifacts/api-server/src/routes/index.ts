// import { Router, type IRouter } from "express";
// import healthRouter from "./health";
// import authRouter from "./auth";
// import usersRouter from "./users";
// import leadsRouter from "./leads";
// import locationRouter from "./location";
// import companyDocumentsRouter from "./company_documents";
// import leaderboardRouter from "./leaderboard";
// import attendanceRouter from "./attendance";
// import storageRouter from "./storage";

// const router: IRouter = Router();

// router.use(healthRouter);
// router.use(authRouter);
// router.use(usersRouter);
// router.use(leadsRouter);
// router.use(locationRouter);
// router.use(companyDocumentsRouter);
// router.use(leaderboardRouter);
// router.use(attendanceRouter);
// router.use(storageRouter);

// export default router;


import express from "express";

import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import leadsRouter from "./leads.js";
import locationRouter from "./location.js";
import companyDocumentsRouter from "./company_documents.js";
import leaderboardRouter from "./leaderboard.js";
import attendanceRouter from "./attendance.js";
import storageRouter from "./storage.js";

const router = express.Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(leadsRouter);
router.use(locationRouter);
router.use(companyDocumentsRouter);
router.use(leaderboardRouter);
router.use(attendanceRouter);
router.use(storageRouter);

export default router;