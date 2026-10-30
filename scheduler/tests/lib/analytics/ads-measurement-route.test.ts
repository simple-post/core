/* eslint-disable unicorn/no-await-expression-member -- Route assertions read the response status directly. */
import { NextRequest } from "next/server";

import { GET, POST, OPTIONS } from "@/app/api/analytics/ads-measurement/route";
import { syncAdsPermission } from "@/lib/analytics/ads-permission";
jest.mock("@/lib/analytics/openai-ads", () => ({ openAiAdsConfigured: jest.fn(() => true) }));
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
jest.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/analytics/ads-permission", () => ({ syncAdsPermission: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { openAiAdsMeasurement: { findUnique: jest.fn() } } }));
function request(body: unknown, origin = "https://simplepost.social") {
  return new NextRequest("https://app.simplepost.social/api/analytics/ads-measurement", {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie: "sp_ads_permission_v1=allowed" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "current-user" } } as never);
});
it.each(["https://evil.example", "https://simplepost.social.evil.example", "null", ""])(
  "rejects cross-origin permission changes from %s",
  async (origin) => {
    expect((await POST(request({ allowed: true }, origin))).status).toBe(403);
    expect(syncAdsPermission).not.toHaveBeenCalled();
  },
);
it("rejects enrollment from stale clients without mutating any permission", async () => {
  const response = await POST(request({ allowed: true, userId: "other-user", permissionGrantedAt: "2000-01-01" }));
  expect(response.status).toBe(410);
  expect(syncAdsPermission).not.toHaveBeenCalled();
  expect(response.headers.get("access-control-allow-origin")).toBe("https://simplepost.social");
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
});
it("browser synchronization only invokes withdrawal-only handling", async () => {
  expect((await POST(request({ sync: true }))).status).toBe(200);
  expect(syncAdsPermission).toHaveBeenCalledWith("current-user", "sp_ads_permission_v1=allowed", undefined);
});
it.each([{}, null, { allowed: "yes" }])("rejects malformed bodies", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(syncAdsPermission).not.toHaveBeenCalled();
});
it("does not enroll anonymous visitors or disclose any account data", async () => {
  jest.mocked(auth.api.getSession).mockResolvedValue(null);
  expect((await POST(request({ sync: true }))).status).toBe(200);
  expect(syncAdsPermission).not.toHaveBeenCalled();
  const response = await GET(new NextRequest("https://app.simplepost.social/api/analytics/ads-measurement"));
  expect(await response.json()).toEqual({
    enabled: false,
    automaticEnrollment: true,
    sharingEnabled: false,
    preference: null,
  });
});
it("reports only preference, never click identifiers, email or delivery metadata", async () => {
  jest.mocked(prisma.openAiAdsMeasurement.findUnique).mockResolvedValue({
    permissionRevokedAt: new Date(),
    clickReference: "private-click",
    userId: "current-user",
  } as never);
  const response = await GET(request({}));
  expect(await response.json()).toEqual({
    enabled: false,
    automaticEnrollment: true,
    sharingEnabled: false,
    preference: "declined",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("allows credentialed preflight only for the owned website", async () => {
  expect((await OPTIONS(request({}))).status).toBe(200);
  const response = await OPTIONS(request({}, "https://evil.example"));
  expect(response.status).toBe(403);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});
it("withdraws only the authenticated account even when another user ID is supplied", async () => {
  const response = await POST(request({ allowed: false, userId: "other-user" }));
  expect(response.status).toBe(200);
  expect(syncAdsPermission).toHaveBeenCalledWith("current-user", "sp_ads_permission_v1=allowed", false);
});
it("does not report a successful account withdrawal after sign-out", async () => {
  jest.mocked(auth.api.getSession).mockResolvedValue(null);
  expect((await POST(request({ allowed: false }))).status).toBe(401);
  expect(syncAdsPermission).not.toHaveBeenCalled();
});
it("keeps the popup hidden while reporting automatic measurement and account withdrawal status", async () => {
  jest.mocked(prisma.openAiAdsMeasurement.findUnique).mockResolvedValue({ permissionRevokedAt: null } as never);
  expect(await (await GET(request({}))).json()).toEqual({
    enabled: false,
    automaticEnrollment: true,
    sharingEnabled: true,
    preference: "allowed",
  });
});
