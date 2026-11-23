/* eslint-disable unicorn/no-await-expression-member */
/** Actual Better Auth + PostgreSQL; only the email provider transport is stubbed. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { auth } from "../lib/auth/auth";
import { prisma } from "../lib/prisma";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/simplepost_review",
    "Disposable local review database required",
  );
  const identity = await prisma.$queryRaw<{ current_database: string; current_user: string }[]>`
    SELECT current_database(), current_user
  `;
  assert.equal(identity[0].current_database, "simplepost_review");
  assert.equal(identity[0].current_user, "postgres");
  assert.equal(process.env.RESEND_API_KEY, "re_local_review");
  assert.equal(process.env.ENABLE_OPENAI_TEST_LOGIN, "true");
  const context = await auth.$context;
  context.rateLimit.enabled = true;
  context.rateLimit.storage = "memory";
  const prefix = `otp-${randomUUID()}`;
  const emails = [`${prefix}@example.invalid`, "demo@simplepost.social", "openai@simplepost.social"];
  const messages = new Map<string, { subject: string; text: string; html: string }>();
  const originalFetch = globalThis.fetch;
  let deliveryFails = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    const message = JSON.parse(String(init?.body));
    messages.set(Array.isArray(message.to) ? message.to[0] : message.to, message);
    return deliveryFails
      ? Response.json({ name: "validation_error", message: "Local delivery failure" }, { status: 422 })
      : Response.json({ id: "local-review-email" });
  };
  let requestNumber = 0;
  const request = (
    path: string,
    body?: unknown,
    ip = `198.51.${Math.floor(requestNumber / 250)}.${++requestNumber % 250}`,
  ) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const send = (email: string) => request("email-otp/send-verification-otp", { email, type: "sign-in" });
  const verify = (email: string, otp: string) => request("sign-in/email-otp", { email, otp });
  const sentCode = (email: string) => messages.get(email)!.subject.match(/^\d{6}/)![0];
  const ok = async (response: Response) => assert.equal(response.status, 200, await response.clone().text());
  const rejected = (response: Response) => assert.ok(response.status >= 400 && response.status < 500);
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  try {
    await ok(await send(emails[0]));
    const forged = await request("sign-in/email-otp", {
      email: emails[0],
      otp: sentCode(emails[0]),
      acquisition: { source: "forged" },
      experimentAttribution: { variant: "forged" },
    });
    assert.equal(forged.status, 400, "Clients cannot set private attribution fields");
    assert.equal(await prisma.user.count({ where: { email: emails[0] } }), 0);
    await ok(await send(emails[0]));
    const code = sentCode(emails[0]);
    const stored = await prisma.verification.findFirstOrThrow({ where: { identifier: `sign-in-otp-${emails[0]}` } });
    assert.ok(!stored.value.includes(code), "OTP must be hashed at rest");
    assert.ok(stored.expiresAt.getTime() - Date.now() > 9 * 60_000);
    const message = messages.get(emails[0])!;
    assert.ok(message.html.includes(`>${code}</p>`));
    assert.ok(message.text.includes(`verification code is ${code}`));
    rejected(await verify(emails[0], code === "000000" ? "000001" : "000000"));
    const signedIn = await verify(emails[0], code);
    await ok(signedIn);
    const cookies = signedIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const session = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie: cookies } }),
    );
    assert.equal((await session.json()).user.email, emails[0]);
    rejected(await verify(emails[0], code));
    await ok(await send(emails[0]));
    const expiredCode = sentCode(emails[0]);
    await prisma.verification.updateMany({
      where: { identifier: `sign-in-otp-${emails[0]}` },
      data: { expiresAt: new Date(0) },
    });
    rejected(await verify(emails[0], expiredCode));
    await ok(await send(emails[0]));
    const lockedCode = sentCode(emails[0]);
    for (let attempt = 0; attempt < 5; attempt++) rejected(await verify(emails[0], "not-a-code"));
    rejected(await verify(emails[0], lockedCode));
    // Resending after exhaustion creates a usable new challenge for a returning user.
    await ok(await send(emails[0]));
    await ok(await verify(emails[0], sentCode(emails[0])));
    assert.equal(await prisma.user.count({ where: { email: emails[0] } }), 1);

    await ok(await send("DEMO@simplepost.social"));
    assert.ok(!messages.has(emails[1]), "Demo sign-in must not send email");
    rejected(await verify(emails[1], "demo"));
    await ok(await verify(emails[1], "123456"));
    await ok(await send(emails[2]));
    assert.ok(messages.has(emails[2]), "Former OpenAI test account must receive a random emailed code");
    rejected(await verify(emails[2], "openai"));
    await ok(await verify(emails[2], sentCode(emails[2])));

    process.env.ENABLE_OPENAI_TEST_LOGIN = "false";
    await ok(await send(emails[1]));
    assert.ok(messages.has(emails[1]), "Disabled demo uses ordinary emailed OTP");
    await ok(await verify(emails[1], sentCode(emails[1])));
    process.env.ENABLE_OPENAI_TEST_LOGIN = "true";

    deliveryFails = true;
    const failed = await send(emails[0]);
    assert.equal(failed.status, 503, "Provider rejection must not report a sent code");
    deliveryFails = false;
    const limitedBody = { email: emails[0], type: "sign-in" };
    for (let attempt = 0; attempt < 3; attempt++)
      await ok(await request("email-otp/send-verification-otp", limitedBody, "203.0.113.10"));
    assert.equal((await request("email-otp/send-verification-otp", limitedBody, "203.0.113.10")).status, 429);
    for (const path of ["sign-in/magic-link", "sign-in/openai-test-user"]) {
      assert.equal((await request(path, { email: emails[1], password: "123456" })).status, 404);
    }
    // eslint-disable-next-line no-console
    console.log(
      "PASS email OTP sessions, hashed storage, expiry, replay, attempt limits, resend, demo flag, removed logins, delivery errors and rate limiting",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.verification.deleteMany({
      where: { identifier: { in: emails.map((email) => `sign-in-otp-${email}`) } },
    });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
