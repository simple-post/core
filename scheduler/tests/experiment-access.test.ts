jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
jest.mock("@/components/login-form", () => ({ LoginForm: () => null }));
jest.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn(), findMany: jest.fn() }, experimentExposure: { findMany: jest.fn() } },
}));
import Experiments from "../app/admin/experiments/page";
import { auth } from "../lib/auth/auth";
import { prisma } from "../lib/prisma";
const getSession = auth.api.getSession as unknown as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SELF_HOSTED = "false";
});
afterEach(() => {
  delete process.env.SELF_HOSTED;
});
test("anonymous and self-hosted requests never query experiment results", async () => {
  getSession.mockResolvedValue(null);
  await Experiments({ searchParams: Promise.resolve({}) });
  expect(prisma.experimentExposure.findMany).not.toHaveBeenCalled();
  process.env.SELF_HOSTED = "true";
  await expect(Experiments({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
});
test("only a currently verified database admin can see aggregate results", async () => {
  getSession.mockResolvedValue({ user: { id: "fixture", isAdmin: true } });
  for (const record of [null, { isAdmin: false, emailVerified: true }, { isAdmin: true, emailVerified: false }]) {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(record);
    await expect(Experiments({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  }
  expect(prisma.experimentExposure.findMany).not.toHaveBeenCalled();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true, emailVerified: true });
  (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.experimentExposure.findMany as jest.Mock).mockResolvedValue([]);
  await Experiments({
    searchParams: Promise.resolve({ experiment: "homepage_workflow_v1", from: "2026-09-01", to: "2026-09-26" }),
  });
  expect(prisma.experimentExposure.findMany).toHaveBeenCalledTimes(1);
});
