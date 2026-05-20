import { Router } from "express";
import { z } from "zod";
import { db, leadsTable, usersTable, leadMeetingsTable, leadDocumentsTable, leadActivitiesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { authenticate, requireRole, AuthRequest } from "../middlewares/auth";

const router = Router();

type LeadStatus = "new" | "not_contacted" | "follow_up" | "meeting_scheduled" | "negotiation" | "closed_won" | "closed_lost";
type LeadSource = "referral" | "walk_in" | "online" | "social" | "broker" | "cold_call" | "field_activity";
type LeadPriority = "hot" | "warm" | "cold";

const createLeadSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  email: z.string().email().optional().nullable(),
  propertyInterest: z.string().optional().nullable(),
  status: z.enum(["new", "not_contacted", "follow_up", "meeting_scheduled", "negotiation", "closed_won", "closed_lost"]).optional(),
  notes: z.string().optional().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  source: z.enum(["referral", "walk_in", "online", "social", "broker", "cold_call", "field_activity"]).optional().nullable(),
  budget: z.string().optional().nullable(),
  priority: z.enum(["hot", "warm", "cold"]).optional().nullable(),
  currentHousing: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

const updateLeadSchema = createLeadSchema.partial().omit({ latitude: true, longitude: true });

function parseId(param: string | string[]): number {
  return parseInt(String(param), 10);
}

// Helper: check if employee can access a lead (owns it, or is admin/manager)
async function canAccessLead(leadId: number, userId: string, role: string): Promise<boolean> {
  if (role === "admin" || role === "manager") return true;
  const [lead] = await db.select({ employeeId: leadsTable.employeeId }).from(leadsTable).where(eq(leadsTable.id, leadId));
  return lead?.employeeId === userId;
}

const LEAD_SELECT = {
  id: leadsTable.id,
  employeeId: leadsTable.employeeId,
  employeeName: usersTable.name,
  name: leadsTable.name,
  phone: leadsTable.phone,
  email: leadsTable.email,
  propertyInterest: leadsTable.propertyInterest,
  status: leadsTable.status,
  notes: leadsTable.notes,
  latitude: leadsTable.latitude,
  longitude: leadsTable.longitude,
  source: leadsTable.source,
  budget: leadsTable.budget,
  priority: leadsTable.priority,
  followUpDate: leadsTable.followUpDate,
  address: leadsTable.address,
  createdAt: leadsTable.createdAt,
  updatedAt: leadsTable.updatedAt,
} as const;

function serializeLead(r: {
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}) {
  return { ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

router.get("/leads", authenticate, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.id as string;

    const rawPage = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const rawLimit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const offset = (rawPage - 1) * rawLimit;

    const baseQuery = db
      .select(LEAD_SELECT)
      .from(leadsTable)
      .leftJoin(usersTable, eq(leadsTable.employeeId, usersTable.id));

    const filteredQuery = role === "admin" || role === "manager"
      ? baseQuery
      : baseQuery.where(eq(leadsTable.employeeId, userId));

    const rows = await filteredQuery.limit(rawLimit).offset(offset).orderBy(desc(leadsTable.createdAt));

    res.setHeader("X-Page", rawPage);
    res.setHeader("X-Limit", rawLimit);
    res.json(rows.map(serializeLead));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leads", authenticate, async (req: AuthRequest, res) => {
  try {
    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map(e => e.message).join(", ") });
      return;
    }
    const {
      name, phone, email, propertyInterest, status, notes, latitude, longitude,
      source, budget, priority, currentHousing, followUpDate, address,
    } = parsed.data;

    // GPS coordinates are mandatory — leads must be geo-tagged at creation time
    if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      res.status(400).json({ error: "GPS coordinates (latitude and longitude) are required to create a lead" });
      return;
    }

    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: "name and phone are required" });
      return;
    }

    const [lead] = await db.insert(leadsTable).values({
      employeeId: req.user!.id,
      name: name.trim(),
      phone: phone.trim(),
      email: email ?? null,
      propertyInterest: propertyInterest ?? null,
      status: status ?? "new",
      notes: notes ?? null,
      latitude: Number(latitude),
      longitude: Number(longitude),
      source: source ?? null,
      budget: budget ?? null,
      priority: priority ?? null,
      currentHousing: currentHousing ?? null,
      followUpDate: followUpDate ?? null,
      address: address ?? null,
    }).returning();
    res.status(201).json({ ...lead, createdAt: lead.createdAt.toISOString(), updatedAt: lead.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/leads/:id", authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;

    const [lead] = await db
      .select(LEAD_SELECT)
      .from(leadsTable)
      .leftJoin(usersTable, eq(leadsTable.employeeId, usersTable.id))
      .where(eq(leadsTable.id, id));

    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    // Employees can only view their own leads
    if (role === "employee" && lead.employeeId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(serializeLead(lead));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/leads/:id", authenticate, async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(id, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map(e => e.message).join(", ") });
      return;
    }
    const {
      name, phone, email, propertyInterest, status, notes,
      source, budget, priority, currentHousing, followUpDate, address,
    } = parsed.data;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) patch.name = name;
    if (phone !== undefined) patch.phone = phone;
    if (email !== undefined) patch.email = email ?? null;
    if (propertyInterest !== undefined) patch.propertyInterest = propertyInterest ?? null;
    if (status !== undefined) patch.status = status;
    if (notes !== undefined) patch.notes = notes ?? null;
    if (source !== undefined) patch.source = source ?? null;
    if (budget !== undefined) patch.budget = budget ?? null;
    if (priority !== undefined) patch.priority = priority ?? null;
    if (currentHousing !== undefined) patch.currentHousing = currentHousing ?? null;
    if (followUpDate !== undefined) patch.followUpDate = followUpDate ?? null;
    if (address !== undefined) patch.address = address ?? null;

    const [updated] = await db.update(leadsTable).set(patch).where(eq(leadsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    const [emp] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.employeeId));
    res.json({ ...updated, employeeName: emp?.name ?? null, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/leads/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const id = parseId(req.params.id);
    const [existing] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await db.delete(leadsTable).where(eq(leadsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Lead meetings
router.get("/leads/:id/meetings", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const meetings = await db.select().from(leadMeetingsTable).where(eq(leadMeetingsTable.leadId, leadId));
    res.json(meetings.map(m => ({ ...m, scheduledAt: m.scheduledAt.toISOString(), createdAt: m.createdAt.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leads/:id/meetings", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { scheduledAt, notes } = req.body;
    const [meeting] = await db.insert(leadMeetingsTable).values({
      leadId, scheduledAt: new Date(scheduledAt), notes: notes ?? null,
    }).returning();
    await db.update(leadsTable).set({ status: "meeting_scheduled", updatedAt: new Date() }).where(eq(leadsTable.id, leadId));
    res.status(201).json({ ...meeting, scheduledAt: meeting.scheduledAt.toISOString(), createdAt: meeting.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/leads/:id/meetings/:meetingId", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const meetingId = parseId(req.params.meetingId);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { scheduledAt, notes } = req.body;
    const [updated] = await db.update(leadMeetingsTable).set({
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      notes: notes ?? null,
    }).where(and(eq(leadMeetingsTable.id, meetingId), eq(leadMeetingsTable.leadId, leadId))).returning();

    if (!updated) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json({ ...updated, scheduledAt: updated.scheduledAt.toISOString(), createdAt: updated.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/leads/:id/meetings/:meetingId", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const meetingId = parseId(req.params.meetingId);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await db.delete(leadMeetingsTable).where(and(eq(leadMeetingsTable.id, meetingId), eq(leadMeetingsTable.leadId, leadId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Lead documents
router.get("/leads/:id/documents", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const docs = await db.select().from(leadDocumentsTable).where(eq(leadDocumentsTable.leadId, leadId));
    res.json(docs.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leads/:id/documents", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;

    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { name, url, mimeType } = req.body;
    const [doc] = await db.insert(leadDocumentsTable).values({
      leadId, name, url, mimeType: mimeType ?? null, uploadedBy: req.user!.id,
    }).returning();
    res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Lead activities (timeline)
router.get("/leads/:id/activities", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;
    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

    const rows = await db
      .select({
        id: leadActivitiesTable.id,
        leadId: leadActivitiesTable.leadId,
        type: leadActivitiesTable.type,
        description: leadActivitiesTable.description,
        createdBy: leadActivitiesTable.createdBy,
        createdByName: usersTable.name,
        createdAt: leadActivitiesTable.createdAt,
      })
      .from(leadActivitiesTable)
      .leftJoin(usersTable, eq(leadActivitiesTable.createdBy, usersTable.id))
      .where(eq(leadActivitiesTable.leadId, leadId))
      .orderBy(desc(leadActivitiesTable.createdAt));

    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leads/:id/activities", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const role = req.user!.role;
    const userId = req.user!.id;
    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

    const { type, description } = req.body as { type?: string; description?: string };
    if (!description?.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    const validTypes = ["note", "call", "email", "whatsapp", "site_visit", "meeting_done", "status_change", "other"] as const;
    const actType = validTypes.includes(type as typeof validTypes[number]) ? (type as typeof validTypes[number]) : "note";

    const [activity] = await db.insert(leadActivitiesTable).values({
      leadId,
      type: actType,
      description: description.trim(),
      createdBy: userId,
    }).returning();

    const [withUser] = await db
      .select({ createdByName: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    res.status(201).json({ ...activity, createdByName: withUser?.createdByName, createdAt: activity.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/leads/:id/activities/:activityId", authenticate, async (req: AuthRequest, res) => {
  try {
    const leadId = parseId(req.params.id);
    const activityId = parseId(req.params.activityId);
    const role = req.user!.role;
    const userId = req.user!.id;
    const allowed = await canAccessLead(leadId, userId, role);
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }

    await db.delete(leadActivitiesTable).where(
      and(eq(leadActivitiesTable.id, activityId), eq(leadActivitiesTable.leadId, leadId))
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
