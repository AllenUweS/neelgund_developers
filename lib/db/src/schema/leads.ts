import { pgTable, text, bigserial, timestamp, real, date, uuid, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sourceEnum = pgEnum("lead_source", [
  "referral",
  "walk_in",
  "online",
  "social",
  "broker",
  "cold_call",
  "field_activity",
]);

export const priorityEnum = pgEnum("lead_priority", ["hot", "warm", "cold"]);

export const leadsTable = pgTable(
  "leads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    propertyInterest: text("property_interest"),
    status: text("status").notNull().default("new"),
    notes: text("notes"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    source: sourceEnum("source"),
    budget: text("budget"),
    priority: priorityEnum("priority"),
    currentHousing: text("current_housing"),
    followUpDate: date("follow_up_date"),
    address: text("address"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    employeeIdx: index("leads_employee_id_idx").on(table.employeeId),
    statusIdx: index("leads_status_idx").on(table.status),
    sourceIdx: index("leads_source_idx").on(table.source),
    priorityIdx: index("leads_priority_idx").on(table.priority),
    createdAtIdx: index("leads_created_at_idx").on(table.createdAt),
  }),
);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
