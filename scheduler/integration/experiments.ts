/* eslint-disable unicorn/no-await-expression-member */
/** Exercises actual Better Auth callbacks with local transport fixtures, plus PostgreSQL triggers. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { auth } from "../lib/auth/auth";
import { type Assignment, assignmentKey, EXPERIMENT_COOKIE, signAssignment } from "../lib/experiments/contract";
import { prisma } from "../lib/prisma";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/simplepost_review",
    "Disposable local review database required",
  );
  assert.equal(process.env.SELF_HOSTED, "false");
  assert.equal(process.env.GOOGLE_CLIENT_ID, "local-review-google");
  assert.equal(process.env.GOOGLE_CLIENT_SECRET, "local-review-google-secret");
  assert.equal(process.env.RESEND_API_KEY, "re_local_review");
  const secret = process.env.HOMEPAGE_EXPERIMENT_SECRET!;
  assert.ok(secret.length >= 32);
  const prefix = `experiment-${randomUUID()}`;
  const emails = [
    `${prefix}-google@example.invalid`,
    `${prefix}-magic@example.invalid`,
    `${prefix}-existing@example.invalid`,
    `${prefix}-retention@example.invalid`,
  ];
  let magicUrl = "";
  let googleEmail = emails[0];
  const originalFetch = globalThis.fetch;
  // Never contact Google or send email. Only provider transport is stubbed; the auth handler and DB are real.
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.resend.com/emails") {
      const body = JSON.parse(String(init?.body));
      magicUrl = String(body.html)
        .match(/href="([^"]+)"/)![1]
        .replaceAll("&amp;", "&");
      return Response.json({ id: "local-review-email" });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const idToken = `${encode({ alg: "none" })}.${encode({ sub: googleEmail, name: "Local experiment fixture", email: googleEmail, email_verified: true })}.local`;
      return Response.json({
        access_token: "local-review-access",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      });
    }
    throw new Error(`Unexpected network request in isolated integration test: ${new URL(url).origin}`);
  };
  const makeAssignment = (variant: "a" | "b"): Assignment => ({
    version: 1,
    id: randomUUID(),
    experimentId: "homepage_workflow_v1",
    variant,
    issuedAt: Date.now() - 1000,
    enrollmentEndsAt: Date.now() + 86_400_000,
  });
  const a = makeAssignment("a"),
    b = makeAssignment("b");
  const cookie = (assignment: Assignment) => `${EXPERIMENT_COOKIE}=${signAssignment(assignment, secret)}`;
  const authCookies = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const request = (path: string, cookies: string, body?: unknown) =>
    new Request(`http://localhost:3000/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers: { cookie: cookies, origin: "http://localhost:3000", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function googleLogin(assignment: Assignment) {
    const start = await auth.handler(
      request("sign-in/social", cookie(assignment), {
        provider: "google",
        callbackURL: "http://localhost:3000/schedule",
      }),
    );
    assert.equal(start.status, 200, await start.clone().text());
    const redirect = new URL((await start.json()).url);
    const response = await auth.handler(
      request(
        `callback/google?code=local&state=${encodeURIComponent(redirect.searchParams.get("state")!)}`,
        `${authCookies(start)}; ${cookie(assignment)}`,
      ),
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://localhost:3000/schedule");
    return response;
  }
  async function magicLogin(assignment: Assignment) {
    magicUrl = "";
    const start = await auth.handler(
      request("sign-in/magic-link", cookie(assignment), {
        email: emails[1],
        name: "Local magic fixture",
        callbackURL: "http://localhost:3000/schedule",
        experimentAttribution: { variant: "forged" },
      }),
    );
    assert.equal(start.status, 200, await start.clone().text());
    assert.ok(magicUrl.startsWith("http://localhost:3000/api/auth/magic-link/verify"));
    const response = await auth.handler(new Request(magicUrl, { headers: { cookie: cookie(assignment) } }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://localhost:3000/schedule");
    return response;
  }
  try {
    const exposure = {
      id: assignmentKey(a),
      experimentId: a.experimentId,
      variant: a.variant,
      assignedAt: new Date(a.issuedAt),
      exposedAt: new Date(),
    };
    await Promise.all(
      Array.from({ length: 8 }, () => prisma.experimentExposure.createMany({ data: exposure, skipDuplicates: true })),
    );
    assert.equal(await prisma.experimentExposure.count({ where: { id: exposure.id } }), 1);
    const firstReceipt = await prisma.experimentExposure.findUniqueOrThrow({ where: { id: exposure.id } });
    await prisma.experimentExposure.createMany({
      data: { ...exposure, exposedAt: new Date(Date.now() + 1000) },
      skipDuplicates: true,
    });
    assert.equal(
      +(await prisma.experimentExposure.findUniqueOrThrow({ where: { id: exposure.id } })).exposedAt,
      +firstReceipt.exposedAt,
    );
    const googleResponse = await googleLogin(a);
    const google = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    assert.equal(JSON.parse(google.experimentAttribution!).assignmentId, assignmentKey(a));
    await googleLogin(b);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: google.id } })).experimentAttribution,
      google.experimentAttribution,
    );
    const session = await auth.handler(request("get-session", authCookies(googleResponse)));
    const sessionBody = await session.json();
    assert.equal(sessionBody.user.id, google.id);
    assert.ok(!Object.hasOwn(sessionBody.user, "experimentAttribution"));
    await auth.handler(
      request("update-user", authCookies(googleResponse), {
        name: "Local fixture",
        experimentAttribution: { variant: "b" },
        isAdmin: true,
      }),
    );
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: google.id } });
    assert.equal(updated.experimentAttribution, google.experimentAttribution);
    assert.equal(updated.isAdmin, false);
    await magicLogin(b);
    const magic = await prisma.user.findUniqueOrThrow({ where: { email: emails[1] } });
    assert.equal(JSON.parse(magic.experimentAttribution!).assignmentId, assignmentKey(b));
    await magicLogin(a);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: magic.id } })).experimentAttribution,
      magic.experimentAttribution,
    );
    // A real pre-existing account must never become an experiment signup on later Google login.
    googleEmail = emails[2];
    const existing = await prisma.user.create({
      data: { id: randomUUID(), email: googleEmail, name: "Existing fixture", emailVerified: true },
    });
    await googleLogin(a);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).experimentAttribution, null);
    const first = new Date(Date.now() + 1000),
      later = new Date(+first + 1000);
    await prisma.connectedAccount.create({
      data: {
        userId: google.id,
        platform: "test",
        platformAccountId: prefix,
        accessToken: "local-fixture",
        createdAt: first,
      },
    });
    const failed = await prisma.post.create({
      data: { userId: google.id, message: "Local database fixture only", status: "failed", publishedAt: first },
    });
    assert.equal(
      (await prisma.experimentMilestone.findUniqueOrThrow({ where: { userId: google.id } })).firstPublishedAt,
      null,
    );
    await prisma.post.update({ where: { id: failed.id }, data: { status: "published" } });
    await Promise.all(
      [later, first].map((publishedAt) =>
        prisma.post.create({
          data: { userId: google.id, message: "Local database fixture only", status: "published", publishedAt },
        }),
      ),
    );
    await prisma.post.deleteMany({ where: { userId: google.id } });
    await prisma.connectedAccount.deleteMany({ where: { userId: google.id } });
    const milestone = await prisma.experimentMilestone.findUniqueOrThrow({ where: { userId: google.id } });
    assert.equal(+milestone.firstPublishedAt!, +first);
    assert.equal(+milestone.firstConnectedAt!, +first);
    await prisma.user.delete({ where: { id: google.id } });
    assert.equal(await prisma.experimentExposure.count({ where: { id: exposure.id } }), 0);
    assert.equal(await prisma.experimentMilestone.count({ where: { userId: google.id } }), 0);
    const oldDate = new Date(Date.now() - 181 * 86_400_000);
    const oldKey = assignmentKey(makeAssignment("a"));
    const old = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: emails[3],
        name: "Retention fixture",
        createdAt: oldDate,
        acquisition: "original-first-touch",
        experimentAttribution: JSON.stringify({
          version: 1,
          assignmentId: oldKey,
          experimentId: a.experimentId,
          variant: "a",
        }),
      },
    });
    await prisma.experimentExposure.create({
      data: { id: oldKey, experimentId: a.experimentId, variant: "a", assignedAt: oldDate, exposedAt: oldDate },
    });
    await prisma.post.create({
      data: { userId: old.id, message: "Local retention fixture", status: "published", publishedAt: oldDate },
    });
    await prisma.firstPayment.create({
      data: {
        userId: old.id,
        stripeInvoiceId: prefix,
        stripeSubscriptionId: prefix,
        paidAt: oldDate,
        amountPaid: 1000,
        currency: "usd",
      },
    });
    execFileSync(process.execPath, ["scripts/prune-experiments.mjs", "--apply"], { stdio: "pipe", env: process.env });
    const retained = await prisma.user.findUniqueOrThrow({
      where: { id: old.id },
      include: { firstPayment: true, experimentMilestone: true },
    });
    assert.equal(retained.experimentAttribution, null);
    assert.equal(retained.experimentMilestone, null);
    assert.equal(retained.acquisition, "original-first-touch");
    assert.equal(retained.firstPayment?.amountPaid, 1000);
    assert.equal(await prisma.experimentExposure.count({ where: { id: oldKey } }), 0);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: magic.id } })).experimentAttribution);
    // eslint-disable-next-line no-console
    console.log(
      "PASS actual Google and magic-link callbacks, immutable private signup attribution, existing-user exclusion, concurrent exposure deduplication, durable first milestones account-deletion cleanup and retention cleanup",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.experimentExposure.deleteMany({ where: { id: { in: [assignmentKey(a), assignmentKey(b)] } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
