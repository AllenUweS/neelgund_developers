import { pgTable, text, bigserial, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companyDocumentsTable = pgTable("company_documents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  category: text("category"),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCompanyDocumentSchema = createInsertSchema(companyDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyDocument = z.infer<typeof insertCompanyDocumentSchema>;
export type CompanyDocument = typeof companyDocumentsTable.$inferSelect;
