// import { Router } from "express";
// import bcrypt from "bcryptjs";
// import { db, usersTable } from "@workspace/db";
// import { eq } from "drizzle-orm";
// import { authenticate, signToken, AuthRequest } from "../middlewares/auth";

// const router = Router();

// router.post("/auth/login", async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     if (!email || !password) {
//       res.status(400).json({ error: "Email and password required" });
//       return;
//     }
//     const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
//     if (!user) {
//       res.status(401).json({ error: "Invalid credentials" });
//       return;
//     }
//     const valid = await bcrypt.compare(password, user.password);
//     if (!valid) {
//       res.status(401).json({ error: "Invalid credentials" });
//       return;
//     }
//     const token = signToken({ id: user.id, email: user.email, role: user.role });
//     res.json({
//       token,
//       user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
//     });
//   } catch (err) {
//     req.log.error(err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

// router.get("/auth/me", authenticate, async (req: AuthRequest, res) => {
//   try {
//     const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
//     if (!user) {
//       res.status(404).json({ error: "User not found" });
//       return;
//     }
//     res.json({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() });
//   } catch (err) {
//     req.log.error(err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });

// export default router;


import express from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, signToken } from "../middlewares/auth.js";

const router = express.Router();

router.post("/auth/login", async (req: any, res: any) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: "Email and password required",
      });
      return;
    }

    // TEMP MOCK USER
    const user: any = {
      id: 1,
      name: "Admin",
      email,
      password: await bcrypt.hash("admin123", 10),
      role: "admin",
      createdAt: new Date(),
    };

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      res.status(401).json({
        error: "Invalid credentials",
      });
      return;
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/auth/me", authenticate, async (req: any, res: any) => {
  try {
    res.json({
      id: 1,
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

export default router;