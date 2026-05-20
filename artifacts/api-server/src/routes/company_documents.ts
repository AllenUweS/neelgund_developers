import { Router } from "express";
import { db, companyDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, requireRole, AuthRequest } from "../middlewares/auth";

const router = Router();

router.get("/company-documents", authenticate, async (req: AuthRequest, res) => {
  try {
    const docs = await db.select().from(companyDocumentsTable);
    res.json(docs.map(d => ({ ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/company-documents", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { name, url, mimeType, category } = req.body;
    const [doc] = await db.insert(companyDocumentsTable).values({
      name, url, mimeType: mimeType ?? null, category: category ?? null, uploadedBy: req.user!.id,
    }).returning();
    res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/company-documents/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { name, url, mimeType, category } = req.body;
    const [doc] = await db.update(companyDocumentsTable).set({
      name, url, mimeType: mimeType ?? null, category: category ?? null, updatedAt: new Date(),
    }).where(eq(companyDocumentsTable.id, id)).returning();
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ ...doc, createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/company-documents/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(companyDocumentsTable).where(eq(companyDocumentsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
