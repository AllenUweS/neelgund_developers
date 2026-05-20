import { pgTable, serial, timestamp, real, text, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const zonesTable = pgTable("zones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  color: text("color"),
  centerLatitude: real("center_latitude"),
  centerLongitude: real("center_longitude"),
  radiusMeters: real("radius_meters"),
  polygonGeoJson: text("polygon_geo_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertZoneSchema = createInsertSchema(zonesTable).omit({ id: true, createdAt: true });
export type InsertZone = z.infer<typeof insertZoneSchema>;
export type Zone = typeof zonesTable.$inferSelect;
