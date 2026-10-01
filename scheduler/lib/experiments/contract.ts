// Wire contract duplicated in the marketing repository and scheduler. Keep both copies in sync.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const EXPERIMENT_COOKIE = "sp_homepage_experiment_v1";
export const OPT_OUT_COOKIE = "sp_experiment_optout";
export const EXPERIMENT_IDS = ["homepage_workflow_aa_v1", "homepage_workflow_v1"] as const;
export const MAX_AGE = 120 * 86_400;
export type Assignment = {
  version: 1;
  id: string;
  experimentId: (typeof EXPERIMENT_IDS)[number];
  variant: "a" | "b";
  issuedAt: number;
  enrollmentEndsAt: number;
};
export function cookieValue(header: string, name: string): string {
  return (
    header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}
export function signAssignment(assignment: Assignment, secret: string): string {
  if (secret.length < 32) throw new Error("Experiment signing key must contain at least 32 characters");
  const payload = Buffer.from(JSON.stringify(assignment)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`homepage:v1:${payload}`).digest("base64url")}`;
}
export function verifyAssignment(token: string, secret: string, now = Date.now()): Assignment | null {
  try {
    if (secret.length < 32 || token.length > 1024) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
    const expected = createHmac("sha256", secret).update(`homepage:v1:${parts[0]}`).digest();
    const received = Buffer.from(parts[1], "base64url");
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) return null;
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Assignment;
    if (value.version !== 1 || !EXPERIMENT_IDS.includes(value.experimentId) || !["a", "b"].includes(value.variant))
      return null;
    if (typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id)) return null;
    if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.enrollmentEndsAt)) return null;
    if (value.issuedAt > now || now >= value.issuedAt + MAX_AGE * 1000) return null;
    if (value.enrollmentEndsAt <= value.issuedAt || value.enrollmentEndsAt > value.issuedAt + MAX_AGE * 1000)
      return null;
    return value;
  } catch {
    return null;
  }
}
export function assignmentKey(assignment: Assignment): string {
  return createHash("sha256").update(`${assignment.experimentId}:${assignment.id}`).digest("hex");
}
export function isOptedOut(headers: Headers): boolean {
  return (
    headers.get("dnt") === "1" ||
    headers.get("sec-gpc") === "1" ||
    cookieValue(headers.get("cookie") || "", OPT_OUT_COOKIE) === "1"
  );
}
