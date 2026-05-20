import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  // Fall back to SESSION_SECRET — it is stable across restarts so tokens
  // remain valid after server restarts (unlike a random ephemeral secret).
  if (process.env.SESSION_SECRET) {
    console.info("[auth] JWT_SECRET not set — using SESSION_SECRET as stable fallback.");
    return process.env.SESSION_SECRET;
  }

  // In production, a missing secret is a hard startup failure.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET or SESSION_SECRET environment variable is required in production."
    );
  }

  const ephemeral = randomBytes(48).toString("hex");
  console.warn(
    "[auth] WARNING: Neither JWT_SECRET nor SESSION_SECRET is set. " +
    "Using an ephemeral random secret — all sessions will be lost on restart."
  );
  return ephemeral;
}

const JWT_SECRET: string = resolveJwtSecret();

export interface AuthPayload {
  id: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
