import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

type SeedUser = {
  name: string;
  email: string;
  password: string;
  role: "admin" | "manager" | "employee";
};

// All demo accounts share the same default password shown in the login screen.
// In production, users should change their passwords after first login.
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "Admin@123";

const DEMO_USERS: SeedUser[] = [
  {
    name: "Admin",
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@neelgund.com",
    password: process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_PASSWORD,
    role: "admin",
  },
  {
    name: "Manager Demo",
    email: "manager@neelgund.com",
    password: DEFAULT_PASSWORD,
    role: "manager",
  },
  {
    name: "Employee Demo",
    email: "employee@neelgund.com",
    password: DEFAULT_PASSWORD,
    role: "employee",
  },
];

async function seed() {
  let created = 0;
  let skipped = 0;

  for (const user of DEMO_USERS) {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, user.email))
      .limit(1);

    if (existing.length > 0) {
      console.log(`Skipped (already exists): ${user.email}`);
      skipped++;
      continue;
    }

    const hashed = await bcrypt.hash(user.password, 10);
    await db.insert(usersTable).values({
      id: sql`gen_random_uuid()`,
      name: user.name,
      email: user.email,
      password: hashed,
      role: user.role,
    });
    console.log(`Created [${user.role}]: ${user.email}`);
    created++;
  }

  console.log(`\nSeed complete: ${created} created, ${skipped} skipped.`);
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
