/** Actual Better Auth hooks with a disposable database; no external conversion requests. */
import assert from "node:assert/strict";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/simplepost_review");
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
  process.env.OPENAI_ADS_MEASUREMENT_ENABLED = "true";
  process.env.OPENAI_ADS_PIXEL_ID = "test-only-pixel";
  process.env.OPENAI_CONVERSIONS_API_KEY = "test-only-key";
  Object.assign(process.env, { NODE_ENV: "production" });
  const { auth } = await import("../lib/auth/auth");
  const { prisma } = await import("../lib/prisma");
  const { syncAdsPermission } = await import("../lib/analytics/ads-permission");
  const { ensureTrialStarted } = await import("../lib/billing/trial");
  const { openAiMilestoneEvents } = await import("../lib/analytics/openai-ads");
  const email = "demo@simplepost.social";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("No outbound requests expected in auth permission test");
  };
  await prisma.user.deleteMany({ where: { email } });
  const click = encodeURIComponent(
    JSON.stringify({ reference: "Opaque+/unchanged==", capturedAt: new Date().toISOString() }),
  );
  async function login() {
    const headers = {
      "content-type": "application/json",
      origin: "https://app.simplepost.social",
      cookie: `sp_ads_permission_v1=allowed; sp_ads_click_v1=${click}`,
    };
    const start = await auth.handler(
      new Request("https://app.simplepost.social/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, type: "sign-in" }),
      }),
    );
    assert.equal(start.status, 200, await start.clone().text());
    const response = await auth.handler(
      new Request("https://app.simplepost.social/api/auth/sign-in/email-otp", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, otp: "123456" }),
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
  }
  try {
    await login();
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { openAiAdsMeasurement: true } });
    assert.equal(user.openAiAdsMeasurement, null, "Signup must not enroll from stale allow cookies");
    await login();
    assert.equal(await prisma.openAiAdsMeasurement.findUnique({ where: { userId: user.id } }), null);
    // Fixture models an existing participant who opted in before enrollment closed.
    await prisma.openAiAdsMeasurement.create({
      data: {
        userId: user.id,
        permissionGrantedAt: new Date(),
        clickReference: "Opaque+/unchanged==",
        clickCapturedAt: new Date(),
      },
    });
    await ensureTrialStarted(user.id);
    const row = await prisma.openAiAdsMeasurement.findUniqueOrThrow({
      where: { userId: user.id },
      include: { user: { include: { freeTrial: true, activationMilestone: true, firstPayment: true } } },
    });
    assert.equal(openAiMilestoneEvents(row).events[0]?.kind, "trial_started");
    await syncAdsPermission(user.id, "", false);
    await login();
    const revoked = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId: user.id } });
    assert.ok(revoked.permissionRevokedAt);
    assert.equal(revoked.clickReference, null);
    // eslint-disable-next-line no-console
    console.log(
      "PASS actual signup and login do not enroll; existing consent remains deliverable and withdrawn permission stays revoked",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
