import { pgTable, bigserial, timestamp, real, text, uuid, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const locationPointsTable = pgTable(
  "location_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    accuracy: real("accuracy"),
    address: text("address"),
    speedKmh: real("speed_kmh"),
    heading: real("heading"),
    altitude: real("altitude"),
    batteryLevel: integer("battery_level"),
    activityType: text("activity_type").default("unknown"),
    source: text("source").default("background"),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => ({
    employeeIdx: index("location_points_employee_id_idx").on(table.employeeId),
    recordedAtIdx: index("location_points_recorded_at_idx").on(table.recordedAt),
  }),
);

export const insertLocationPointSchema = createInsertSchema(locationPointsTable).omit({ id: true });
export type InsertLocationPoint = z.infer<typeof insertLocationPointSchema>;
export type LocationPoint = typeof locationPointsTable.$inferSelect;
