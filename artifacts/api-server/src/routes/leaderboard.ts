import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authenticate, AuthRequest } from "../middlewares/auth";

const router = Router();

router.get("/leaderboard", authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        u.id as "employeeId",
        u.name as "employeeName",
        COUNT(l.id)::int as "totalLeads",
        COUNT(CASE WHEN l.status = 'closed_won' THEN 1 END)::int as "closedWon",
        RANK() OVER (ORDER BY COUNT(l.id) DESC, COUNT(CASE WHEN l.status = 'closed_won' THEN 1 END) DESC)::int as rank
      FROM users u
      LEFT JOIN leads l ON l.employee_id = u.id
      WHERE u.role = 'employee'
      GROUP BY u.id, u.name
      ORDER BY rank ASC
    `);
    res.json(result.rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
