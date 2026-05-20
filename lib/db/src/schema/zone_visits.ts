import { pgTable, serial, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const zoneVisitsTable = pgTable("zone_visits", {
  id: serial("id").primaryKey(),
  zoneId: integer("zone_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  enteredAt: timestamp("entered_at").notNull(),
  exitedAt: timestamp("exited_at"),
  locationPointId: integer("location_point_id"),
});

export const insertZoneVisitSchema = createInsertSchema(zoneVisitsTable).omit({ id: true });
export type InsertZoneVisit = z.infer<typeof insertZoneVisitSchema>;
export type ZoneVisit = typeof zoneVisitsTable.$inferSelect;
