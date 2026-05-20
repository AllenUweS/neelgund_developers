import { pgTable, text, bigserial, timestamp, bigint, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadDocumentsTable = pgTable(
  "lead_documents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadId: bigint("lead_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    mimeType: text("mime_type"),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("lead_documents_lead_id_idx").on(table.leadId),
  }),
);

export const insertLeadDocumentSchema = createInsertSchema(leadDocumentsTable).omit({ id: true, createdAt: true });
export type InsertLeadDocument = z.infer<typeof insertLeadDocumentSchema>;
export type LeadDocument = typeof leadDocumentsTable.$inferSelect;
