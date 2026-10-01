/* eslint-disable unicorn/no-await-expression-member */
jest.mock("@/lib/prisma", () => ({ prisma: { experimentExposure: { createMany: jest.fn() } } }));
import { POST } from "../app/api/internal/experiments/exposure/route";
import { type Assignment, assignmentKey, signAssignment } from "../lib/experiments/contract";
import { prisma } from "../lib/prisma";
const secret = "test-only-signing-secret-not-production";
const assignment: Assignment = {
  version: 1,
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  experimentId: "homepage_workflow_v1",
  variant: "b",
  issuedAt: Date.now() - 1000,
  enrollmentEndsAt: Date.now() + 86_400_000,
};
const request = (body: unknown, auth = `Bearer ${secret}`) =>
  new Request("http://localhost/api/internal/experiments/exposure", {
    method: "POST",
    headers: { authorization: auth },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  jest.clearAllMocks();
  process.env.HOMEPAGE_EXPERIMENT_SECRET = secret;
  process.env.EXPERIMENT_INGEST_ENABLED = "true";
  process.env.SELF_HOSTED = "false";
});
afterEach(() => {
  delete process.env.HOMEPAGE_EXPERIMENT_SECRET;
  delete process.env.EXPERIMENT_INGEST_ENABLED;
  delete process.env.SELF_HOSTED;
});
test("disabled, self-hosted and unauthorized requests cannot write exposures", async () => {
  const body = { token: signAssignment(assignment, secret) };
  expect((await POST(request(body, "bad"))).status).toBe(403);
  process.env.EXPERIMENT_INGEST_ENABLED = "false";
  expect((await POST(request(body))).status).toBe(403);
  process.env.EXPERIMENT_INGEST_ENABLED = "true";
  process.env.SELF_HOSTED = "true";
  expect((await POST(request(body))).status).toBe(403);
  expect(prisma.experimentExposure.createMany).not.toHaveBeenCalled();
});
test("valid exposures persist only a hash and never update their original receipt time", async () => {
  const response = await POST(request({ token: signAssignment(assignment, secret) }));
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(prisma.experimentExposure.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      skipDuplicates: true,
      data: expect.objectContaining({
        id: assignmentKey(assignment),
        variant: "b",
        experimentId: assignment.experimentId,
      }),
    }),
  );
  expect(JSON.stringify((prisma.experimentExposure.createMany as jest.Mock).mock.calls)).not.toContain(assignment.id);
});
test("forged, expired enrollment, oversized and failed persistence are rejected", async () => {
  expect((await POST(request({ token: "forged" }))).status).toBe(400);
  expect(
    (await POST(request({ token: signAssignment({ ...assignment, enrollmentEndsAt: Date.now() - 1 }, secret) })))
      .status,
  ).toBe(400);
  expect((await POST(request({ token: "a".repeat(1600) }))).status).toBe(413);
  (prisma.experimentExposure.createMany as jest.Mock).mockRejectedValueOnce(new Error("unavailable"));
  expect((await POST(request({ token: signAssignment(assignment, secret) }))).status).toBe(503);
});
