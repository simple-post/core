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
  const email = "ads-enrollment-review@example.invalid";
  let sentOtp = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    sentOtp = JSON.parse(String(init?.body)).subject.match(/^\d{6}/)[0];
    return Response.json({ id: "local-review-email" });
  };
  await prisma.user.deleteMany({ where: { email } });
  async function login() {
    const headers = {
      "content-type": "application/json",
      origin: "https://app.simplepost.social",
      cookie: "",
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
        body: JSON.stringify({ email, otp: sentOtp }),
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
  }
  try {
    await login();
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { openAiAdsMeasurement: true } });
    assert.equal(user.openAiAdsMeasurement?.enrollmentMode, "automatic");
    assert.equal(user.openAiAdsMeasurement.permissionGrantedAt, null);
    assert.equal(user.openAiAdsMeasurement.permissionRevokedAt, null);
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
      "PASS actual signup automatically enrolls without a consent cookie; milestones are deliverable; opt-outs survive returning login",
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
