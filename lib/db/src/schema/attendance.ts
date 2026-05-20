import { pgTable, bigserial, timestamp, real, text, date, uuid, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceTable = pgTable(
  "attendance",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date").notNull(),
    checkInTime: timestamp("check_in_time"),
    checkOutTime: timestamp("check_out_time"),
    checkInLatitude: real("check_in_latitude"),
    checkInLongitude: real("check_in_longitude"),
    checkOutLatitude: real("check_out_latitude"),
    checkOutLongitude: real("check_out_longitude"),
    status: text("status").default("present"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    attendanceEmployeeDateUnique: unique("attendance_employee_date_unique").on(table.employeeId, table.date),
    employeeIdx: index("attendance_employee_id_idx").on(table.employeeId),
    dateIdx: index("attendance_date_idx").on(table.date),
  }),
);

export const attendanceRegularizationsTable = pgTable(
  "attendance_regularizations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    attendanceId: bigserial("attendance_id", { mode: "number" }).notNull(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date").notNull(),
    requestedCheckInTime: timestamp("requested_check_in_time"),
    requestedCheckOutTime: timestamp("requested_check_out_time"),
    reason: text("reason"),
    status: text("status").default("pending"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    attendanceUnique: unique("attendance_regularizations_attendance_id_unique").on(table.attendanceId),
    employeeIdx: index("idx_attendance_regularizations_employee_id").on(table.employeeId),
    statusIdx: index("idx_attendance_regularizations_status").on(table.status),
    dateIdx: index("idx_attendance_regularizations_date").on(table.date),
  }),
);

export const insertAttendanceRegularizationSchema = createInsertSchema(attendanceRegularizationsTable).omit({
  id: true,
  resolvedBy: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAttendanceRegularization = z.infer<typeof insertAttendanceRegularizationSchema>;
export type AttendanceRegularization = typeof attendanceRegularizationsTable.$inferSelect;

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
