import { pgTable, bigserial, timestamp, real, text, uuid, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stopsTable = pgTable(
  "stops",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at"),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    radiusMeters: real("radius_meters").notNull().default(0),
    durationMs: integer("duration_ms"),
    stopType: text("stop_type").notNull().default("short"),
    address: text("address"),
    zoneId: integer("zone_id"),
    leadId: integer("lead_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    employeeDateIdx: index("stops_employee_date_idx").on(table.employeeId, table.startAt),
    activeIdx: index("stops_active_idx").on(table.employeeId, table.endAt),
  }),
);

export const insertStopSchema = createInsertSchema(stopsTable).omit({ id: true, createdAt: true });
export type InsertStop = z.infer<typeof insertStopSchema>;
export type Stop = typeof stopsTable.$inferSelect;
