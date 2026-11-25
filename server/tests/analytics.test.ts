import { getAccountAnalytics, getPostAnalytics } from "@simple-post/sdk";
import express from "express";

import { getAccountById, getAccounts } from "../src/config/accounts.js";
import analyticsRoutes from "../src/routes/analytics.js";

import type http from "node:http";
import type { AddressInfo } from "node:net";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  getPostAnalytics: jest.fn(),
  getAccountAnalytics: jest.fn(),
}));
jest.mock("../src/config/accounts.js", () => ({ getAccountById: jest.fn(), getAccounts: jest.fn() }));

const accounts = {
  x: { id: "x", platform: "x", rawPlatform: "x", credentials: { accessToken: "token" } },
  bsky: {
    id: "bsky",
    platform: "bluesky",
    rawPlatform: "bluesky",
    credentials: { identifier: "me", appPassword: "pw" },
  },
};

async function request(method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/analytics", analyticsRoutes);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => (server as http.Server).close(resolve));
  }
}

beforeEach(() => {
  jest.mocked(getAccountById).mockImplementation((id) => accounts[id as keyof typeof accounts] as never);
  jest.mocked(getAccounts).mockReturnValue(Object.values(accounts) as never);
});

it("reads post analytics grouped by account", async () => {
  jest.mocked(getPostAnalytics).mockImplementation(async ({ platform, targets }) => ({
    platform,
    results: targets.map((target) => ({
      platform,
      postId: target.postId,
      status: "ok" as const,
      metrics: { likes: 2, comments: 1 },
      fetchedAt: "2026-11-21T00:00:00.000Z",
    })),
  }));

  const response = await request("POST", "/api/v1/analytics/posts", {
    targets: [
      { accountId: "x", postId: "1" },
      { accountId: "bsky", postId: "at://did/app.bsky.feed.post/1" },
      { accountId: "x", postId: "2" },
    ],
  });

  expect(response.status).toBe(200);
  expect(getPostAnalytics).toHaveBeenCalledTimes(2);
  expect(jest.mocked(getPostAnalytics).mock.calls[0][0]).toEqual(
    expect.objectContaining({
      platform: "x",
      targets: [expect.objectContaining({ postId: "1" }), expect.objectContaining({ postId: "2" })],
      options: { x: expect.objectContaining({ credentials: { accessToken: "token" } }) },
    })
  );
  expect(response.body.results).toHaveLength(3);
  expect(response.body.results[0]).toEqual(expect.objectContaining({ accountId: "x", engagements: 3 }));
});

it("rejects unknown accounts and invalid bodies", async () => {
  const empty = await request("POST", "/api/v1/analytics/posts", { targets: [] });
  expect(empty.status).toBe(400);
  const unknown = await request("POST", "/api/v1/analytics/posts", { targets: [{ accountId: "nope", postId: "1" }] });
  expect(unknown.status).toBe(400);
  expect(unknown.body.error).toContain("nope");
});

it("reads account analytics without exposing refreshed credentials", async () => {
  jest.mocked(getAccountAnalytics).mockResolvedValue({
    platform: "x",
    status: "ok",
    metrics: { followers: 10 },
    fetchedAt: "2026-11-21T00:00:00.000Z",
    refreshedCredentials: { accessToken: "secret" },
  });
  const response = await request("GET", "/api/v1/analytics/accounts?accountId=x");
  expect(response.status).toBe(200);
  expect(response.body.accounts).toEqual([expect.objectContaining({ accountId: "x", metrics: { followers: 10 } })]);
  expect(JSON.stringify(response.body)).not.toContain("secret");
});
