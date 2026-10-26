/** Run with tsx; Better Auth's ESM runtime is intentionally exercised without Jest mocks. */
import assert from "node:assert/strict";

import { FIRST_TOUCH_COOKIE, createFirstTouch } from "../lib/analytics/first-touch";
import { auth } from "../lib/auth/auth";
import { prisma } from "../lib/prisma";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/simplepost_review",
    "Disposable local review database required",
  );
  assert.ok(process.env.ENABLE_OPENAI_TEST_LOGIN === "true");
  const emails = ["demo@simplepost.social", "attribution-review@example.invalid"];
  let sentOtp = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    sentOtp = JSON.parse(String(init?.body)).subject.match(/^\d{6}/)[0];
    return Response.json({ id: "local-review-email" });
  };
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  async function login(email: string, source?: string) {
    const cookie = source
      ? `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(JSON.stringify(createFirstTouch(`https://simplepost.social/?utm_source=${source}`, "")))}`
      : "";
    const headers = { "content-type": "application/json", origin: "http://localhost:3000", cookie };
    const start = await auth.handler(
      new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, type: "sign-in" }),
      }),
    );
    assert.equal(start.status, 200, await start.clone().text());
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          otp: email === emails[0] ? "123456" : sentOtp,
        }),
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    return response;
  }
  try {
    const response = await login(emails[0], "chatgpt");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.equal(JSON.parse(user.acquisition!).source, "chatgpt");
    await login(emails[0], "overwritten");
    const returningUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual(returningUser.acquisition, user.acquisition);
    const cookies = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const session = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie: cookies } }),
    );
    const payload = await session.json();
    assert.equal(payload.user.id, user.id);
    assert.ok(!Object.hasOwn(payload.user, "acquisition"), "Auth responses must not expose acquisition");
    await auth.handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: cookies },
        body: JSON.stringify({ name: "Demo User", isAdmin: true }),
      }),
    );
    const attemptedAdmin = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(attemptedAdmin.isAdmin, false, "Auth profile updates must not grant admin access");
    await login(emails[1]);
    const unknown = await prisma.user.findUniqueOrThrow({ where: { email: emails[1] } });
    assert.equal(JSON.parse(unknown.acquisition!).source, "unknown");
    // eslint-disable-next-line no-console
    console.log(
      "PASS actual Better Auth account creation, immutable first touch, unknown fallback, private auth responses and admin self-promotion denial",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
