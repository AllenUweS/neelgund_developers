import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authenticate, requireRole, AuthRequest } from "../middlewares/auth";

const router = Router();

const USER_SELECT = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  phone: usersTable.phone,
  department: usersTable.department,
  designation: usersTable.designation,
  joiningDate: usersTable.joiningDate,
  profileNotes: usersTable.profileNotes,
  createdAt: usersTable.createdAt,
} as const;

const roleEnum = z.enum(["admin", "super_admin", "hr", "manager", "employee", "transport"]);

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: roleEnum,
  phone: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  joiningDate: z.string().optional().nullable(),
  profileNotes: z.string().optional().nullable(),
});

const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional().nullable(),
});

function serializeUser(u: {
  id: string;
  name: string;
  email: string;
  role: "admin" | "super_admin" | "hr" | "manager" | "employee" | "transport";
  phone: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string | null;
  profileNotes: string | null;
  createdAt: Date;
}) {
  return { ...u, createdAt: u.createdAt.toISOString() };
}

router.get("/users", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const users = await db.select(USER_SELECT).from(usersTable);
    res.json(users.map(serializeUser));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map(e => e.message).join(", ") });
      return;
    }
    const { name, email, password, role, phone, department, designation, joiningDate, profileNotes } = parsed.data;
    const hashed = await bcrypt.hash(password, 10);
    const [user] = await db.insert(usersTable).values({
      id: sql`gen_random_uuid()`,
      name,
      email,
      password: hashed,
      role,
      phone: phone ?? null,
      department: department ?? null,
      designation: designation ?? null,
      joiningDate: joiningDate ?? null,
      profileNotes: profileNotes ?? null,
    }).returning();
    res.status(201).json(serializeUser({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      department: user.department,
      designation: user.designation,
      joiningDate: user.joiningDate,
      profileNotes: user.profileNotes,
      createdAt: user.createdAt,
    }));
  } catch (err: unknown) {
    req.log.error(err);
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
      res.status(400).json({ error: "Email already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/users/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map(e => e.message).join(", ") });
      return;
    }
    const { name, email, role, password, phone, department, designation, joiningDate, profileNotes } = parsed.data;

    const patch: Record<string, unknown> = {};
    if (name?.trim()) patch.name = name.trim();
    if (email?.trim()) patch.email = email.trim().toLowerCase();
    if (role) patch.role = role as "admin" | "super_admin" | "hr" | "manager" | "employee" | "transport";
    if (password?.trim()) patch.password = await bcrypt.hash(password.trim(), 10);
    if (phone !== undefined) patch.phone = phone?.trim() || null;
    if (department !== undefined) patch.department = department?.trim() || null;
    if (designation !== undefined) patch.designation = designation?.trim() || null;
    if (joiningDate !== undefined) patch.joiningDate = joiningDate || null;
    if (profileNotes !== undefined) patch.profileNotes = profileNotes?.trim() || null;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(usersTable).set(patch).where(eq(usersTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(serializeUser({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      phone: updated.phone,
      department: updated.department,
      designation: updated.designation,
      joiningDate: updated.joiningDate,
      profileNotes: updated.profileNotes,
      createdAt: updated.createdAt,
    }));
  } catch (err: unknown) {
    req.log.error(err);
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
      res.status(400).json({ error: "Email already in use" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/users/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id);
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
