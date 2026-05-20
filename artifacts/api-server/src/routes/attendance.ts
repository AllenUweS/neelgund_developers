import { Router } from "express";
import { z } from "zod";
import { db, attendanceTable, usersTable, type Attendance } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { authenticate, requireRole, AuthRequest } from "../middlewares/auth";

type AttendanceUpdate = Partial<Pick<Attendance, "status" | "notes" | "checkInTime" | "checkOutTime" | "updatedAt">>;

const router = Router();

function todayDateStr(): string {
  return new Date().toISOString().split("T")[0];
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

router.get("/attendance/today", authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const today = todayDateStr();

    if (user.role === "employee") {
      const [record] = await db
        .select()
        .from(attendanceTable)
        .where(and(eq(attendanceTable.employeeId, user.id as unknown as string), eq(attendanceTable.date, today)));
      return res.json(record ?? null);
    }

    const records = await db
      .select({
        id: attendanceTable.id,
        employeeId: attendanceTable.employeeId,
        employeeName: usersTable.name,
        date: attendanceTable.date,
        checkInTime: attendanceTable.checkInTime,
        checkOutTime: attendanceTable.checkOutTime,
        checkInLatitude: attendanceTable.checkInLatitude,
        checkInLongitude: attendanceTable.checkInLongitude,
        checkOutLatitude: attendanceTable.checkOutLatitude,
        checkOutLongitude: attendanceTable.checkOutLongitude,
        status: attendanceTable.status,
        notes: attendanceTable.notes,
      })
      .from(attendanceTable)
      .leftJoin(usersTable, eq(attendanceTable.employeeId, usersTable.id))
      .where(eq(attendanceTable.date, today))
      .orderBy(desc(attendanceTable.checkInTime));

    return res.json(records);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/attendance", authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const { date, employeeId, month } = req.query as { date?: string; employeeId?: string; month?: string };

    const conditions = [];

    if (user.role === "employee") {
      conditions.push(eq(attendanceTable.employeeId, user.id as unknown as string));
    } else if (employeeId) {
      conditions.push(eq(attendanceTable.employeeId, employeeId as string));
    }

    if (date) {
      conditions.push(eq(attendanceTable.date, date));
    } else if (month) {
      conditions.push(sql`date_trunc('month', ${attendanceTable.date}::timestamp) = date_trunc('month', ${month}::timestamp)`);
    }

    const records = await db
      .select({
        id: attendanceTable.id,
        employeeId: attendanceTable.employeeId,
        employeeName: usersTable.name,
        date: attendanceTable.date,
        checkInTime: attendanceTable.checkInTime,
        checkOutTime: attendanceTable.checkOutTime,
        checkInLatitude: attendanceTable.checkInLatitude,
        checkInLongitude: attendanceTable.checkInLongitude,
        checkOutLatitude: attendanceTable.checkOutLatitude,
        checkOutLongitude: attendanceTable.checkOutLongitude,
        status: attendanceTable.status,
        notes: attendanceTable.notes,
        createdAt: attendanceTable.createdAt,
      })
      .from(attendanceTable)
      .leftJoin(usersTable, eq(attendanceTable.employeeId, usersTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(attendanceTable.date), desc(attendanceTable.checkInTime));

    return res.json(records);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/checkin", authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const today = todayDateStr();
    const { latitude, longitude, notes } = req.body as {
      latitude?: number;
      longitude?: number;
      notes?: string;
    };

    const [existing] = await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.employeeId, user.id), eq(attendanceTable.date, today)));

    if (existing) {
      return res.status(409).json({ error: "Already checked in today" });
    }

    const now = new Date();
    const [record] = await db
      .insert(attendanceTable)
      .values({
        employeeId: user.id,
        date: today,
        checkInTime: now,
        checkInLatitude: latitude ?? null,
        checkInLongitude: longitude ?? null,
        status: "present",
        notes: notes ?? null,
      })
      .returning();

    return res.status(201).json(record);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/checkout", authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const today = todayDateStr();
    const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };

    const [existing] = await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.employeeId, user.id), eq(attendanceTable.date, today)));

    if (!existing) {
      return res.status(400).json({ error: "No check-in found for today" });
    }
    if (existing.checkOutTime) {
      return res.status(409).json({ error: "Already checked out today" });
    }

    const now = new Date();
    const [updated] = await db
      .update(attendanceTable)
      .set({
        checkOutTime: now,
        checkOutLatitude: latitude ?? null,
        checkOutLongitude: longitude ?? null,
        updatedAt: now,
      })
      .where(eq(attendanceTable.id, existing.id))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const adminCreateAttendanceSchema = z.object({
  employeeId: z.string().uuid("employeeId must be a valid UUID"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  status: z.enum(["present", "absent", "half_day"]).optional(),
  notes: z.string().optional(),
});

const updateAttendanceSchema = z.object({
  status: z.enum(["present", "absent", "half_day"]).optional(),
  notes: z.string().optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
});

// Admin/manager manually create an attendance record for any employee on any date
router.post("/attendance/admin-create", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const parsed = adminCreateAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map(e => e.message).join(", ") });
      return;
    }
    const { employeeId, date, checkInTime, checkOutTime, status, notes } = parsed.data;

    if (!isValidDate(date)) {
      res.status(400).json({ error: "date must be a valid YYYY-MM-DD string" });
      return;
    }

    // Validate optional datetime strings early — return clean 400 instead of 500
    let checkIn: Date | null = null;
    let checkOut: Date | null = null;
    if (checkInTime) {
      checkIn = new Date(checkInTime);
      if (isNaN(checkIn.getTime())) {
        res.status(400).json({ error: "checkInTime is not a valid ISO date-time string" });
        return;
      }
    }
    if (checkOutTime) {
      checkOut = new Date(checkOutTime);
      if (isNaN(checkOut.getTime())) {
        res.status(400).json({ error: "checkOutTime is not a valid ISO date-time string" });
        return;
      }
    }

    if (checkOut && !checkIn) {
      res.status(400).json({ error: "checkOutTime requires checkInTime" });
      return;
    }

    // Verify the employee actually exists
    const [employee] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, employeeId));

    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    // Prevent duplicate records for same employee + date
    const [existing] = await db
      .select({ id: attendanceTable.id })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.employeeId, employeeId), eq(attendanceTable.date, date)));

    if (existing) {
      res.status(409).json({ error: "An attendance record already exists for this employee on this date" });
      return;
    }

    const [record] = await db.insert(attendanceTable).values({
      employeeId: employeeId,
      date,
      checkInTime: checkIn,
      checkOutTime: checkOut,
      status: status ?? "present",
      notes: notes ?? null,
    }).returning();

    return res.status(201).json(record);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/attendance/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const parsed = updateAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map(e => e.message).join(", ") });
      return;
    }
    const { status, notes, checkInTime, checkOutTime } = parsed.data;

    const updateData: AttendanceUpdate = { updatedAt: new Date() };
    if (status) updateData.status = status as Attendance["status"];
    if (notes !== undefined) updateData.notes = notes;
    if (checkInTime) updateData.checkInTime = new Date(checkInTime);
    if (checkOutTime) updateData.checkOutTime = new Date(checkOutTime);

    const [updated] = await db
      .update(attendanceTable)
      .set(updateData)
      .where(eq(attendanceTable.id, Number(id)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Record not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/attendance/summary", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const { month } = req.query as { month?: string };
    const targetMonth = month ?? todayDateStr().slice(0, 7);

    const rows = await db
      .select({
        employeeId: attendanceTable.employeeId,
        employeeName: usersTable.name,
        totalPresent: sql<number>`count(*) filter (where ${attendanceTable.status} = 'present')`,
        totalHalfDay: sql<number>`count(*) filter (where ${attendanceTable.status} = 'half_day')`,
        totalAbsent: sql<number>`count(*) filter (where ${attendanceTable.status} = 'absent')`,
        avgCheckIn: sql<string>`to_char(avg(extract(epoch from ${attendanceTable.checkInTime}::time))::int * interval '1 second', 'HH24:MI')`,
      })
      .from(attendanceTable)
      .leftJoin(usersTable, eq(attendanceTable.employeeId, usersTable.id))
      .where(sql`date_trunc('month', ${attendanceTable.date}::timestamp) = date_trunc('month', ${targetMonth + "-01"}::timestamp)`)
      .groupBy(attendanceTable.employeeId, usersTable.name)
      .orderBy(usersTable.name);

    return res.json(rows);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
