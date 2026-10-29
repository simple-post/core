/* eslint-disable unicorn/no-await-expression-member -- Route assertions read the response status directly. */
import { NextRequest } from "next/server";

import { GET, POST, OPTIONS } from "@/app/api/analytics/ads-measurement/route";
import { syncAdsPermission } from "@/lib/analytics/ads-permission";
import { openAiAdsConfigured } from "@/lib/analytics/openai-ads";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
jest.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/analytics/ads-permission", () => ({ syncAdsPermission: jest.fn() }));
jest.mock("@/lib/analytics/openai-ads", () => ({ openAiAdsConfigured: jest.fn(() => true) }));
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
  jest.mocked(openAiAdsConfigured).mockReturnValue(true);
  jest.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "current-user" } } as never);
});
it.each(["https://evil.example", "https://simplepost.social.evil.example", "null", ""])(
  "rejects cross-origin permission changes from %s",
  async (origin) => {
    expect((await POST(request({ allowed: true }, origin))).status).toBe(403);
    expect(syncAdsPermission).not.toHaveBeenCalled();
  },
);
it("grants only for the authenticated user, ignoring supplied IDs and permission dates", async () => {
  const response = await POST(request({ allowed: true, userId: "other-user", permissionGrantedAt: "2000-01-01" }));
  expect(response.status).toBe(200);
  expect(syncAdsPermission).toHaveBeenCalledWith("current-user", "sp_ads_permission_v1=allowed", true);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://simplepost.social");
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
});
it("browser synchronization cannot regrant revoked permission", async () => {
  expect((await POST(request({ sync: true }))).status).toBe(200);
  expect(syncAdsPermission).toHaveBeenCalledWith("current-user", "sp_ads_permission_v1=allowed", undefined);
});
it.each([{}, null, { allowed: "yes" }])("rejects malformed bodies", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(syncAdsPermission).not.toHaveBeenCalled();
});
it("does not enroll anonymous visitors or disclose any account data", async () => {
  jest.mocked(auth.api.getSession).mockResolvedValue(null);
  expect((await POST(request({ allowed: true }))).status).toBe(200);
  expect(syncAdsPermission).not.toHaveBeenCalled();
  const response = await GET(new NextRequest("https://app.simplepost.social/api/analytics/ads-measurement"));
  expect(await response.json()).toEqual({ enabled: true, preference: null });
});
it("reports only preference, never click identifiers, email or delivery metadata", async () => {
  jest.mocked(prisma.openAiAdsMeasurement.findUnique).mockResolvedValue({
    permissionRevokedAt: new Date(),
    clickReference: "private-click",
    userId: "current-user",
  } as never);
  const response = await GET(request({}));
  expect(await response.json()).toEqual({ enabled: true, preference: "declined" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("allows credentialed preflight only for the owned website", async () => {
  expect((await OPTIONS(request({}))).status).toBe(200);
  const response = await OPTIONS(request({}, "https://evil.example"));
  expect(response.status).toBe(403);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});
it("does not offer measurement when production settings are incomplete", async () => {
  jest.mocked(openAiAdsConfigured).mockReturnValue(false);
  expect(await (await GET(request({}))).json()).toEqual({ enabled: false });
  expect((await POST(request({ allowed: true }))).status).toBe(404);
  expect(syncAdsPermission).not.toHaveBeenCalled();
});
