import { pgTable, text, bigserial, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadMeetingsTable = pgTable(
  "lead_meetings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadId: bigint("lead_id", { mode: "number" }).notNull(),
    scheduledAt: timestamp("scheduled_at").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("lead_meetings_lead_id_idx").on(table.leadId),
  }),
);

export const insertLeadMeetingSchema = createInsertSchema(leadMeetingsTable).omit({ id: true, createdAt: true });
export type InsertLeadMeeting = z.infer<typeof insertLeadMeetingSchema>;
export type LeadMeeting = typeof leadMeetingsTable.$inferSelect;
