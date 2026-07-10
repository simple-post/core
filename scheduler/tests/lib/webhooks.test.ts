import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import { assertValidWebhookUrl, dispatchPostWebhooks, signWebhookBody } from "@/lib/webhooks";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    webhookEndpoint: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  webhookEndpoint: { findMany: jest.Mock; update: jest.Mock };
};

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  prismaMock.webhookEndpoint.update.mockResolvedValue({});
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
});

describe("signWebhookBody", () => {
  it("produces a verifiable HMAC-SHA256 over timestamp.body", () => {
    const signature = signWebhookBody("secret", "123", '{"a":1}');

    const expected = crypto.createHmac("sha256", "secret").update('123.{"a":1}').digest("hex");
    expect(signature).toBe(expected);
  });
});

describe("assertValidWebhookUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(() => assertValidWebhookUrl("https://example.com/hooks")).not.toThrow();
    expect(() => assertValidWebhookUrl("http://example.com/hooks")).not.toThrow();
  });

  it.each([
    "ftp://example.com/hooks",
    "https://localhost/hooks",
    "http://127.0.0.1/hooks",
    "http://10.1.2.3/hooks",
    "http://192.168.1.1/hooks",
    "http://169.254.169.254/latest",
    "http://172.16.0.1/hooks",
    "http://[::ffff:127.0.0.1]/hooks",
    "http://metadata.google.internal/x",
    "http://service.internal/x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertValidWebhookUrl(url)).toThrow();
  });
});

describe("dispatchPostWebhooks", () => {
  const post = { id: "p1", status: "published" as const, message: "hello" };

  it("does nothing when the user has no matching endpoints", async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([]);

    await dispatchPostWebhooks("u1", "post.published", post);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers a signed payload to each subscribed endpoint", async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook1", secret: "s1" },
      { id: "w2", url: "https://example.com/hook2", secret: "s2" },
    ]);

    await dispatchPostWebhooks("u1", "post.published", post);

    expect(prismaMock.webhookEndpoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", active: true, events: { has: "post.published" } },
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/hook1");
    expect(init.headers["X-SimplePost-Event"]).toBe("post.published");

    const body = JSON.parse(init.body);
    expect(body.event).toBe("post.published");
    expect(body.post.id).toBe("p1");

    const timestamp = init.headers["X-SimplePost-Timestamp"];
    expect(init.headers["X-SimplePost-Signature"]).toBe(`sha256=${signWebhookBody("s1", timestamp, init.body)}`);
  });

  it("records delivery failures without throwing", async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: "s1" },
    ]);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(dispatchPostWebhooks("u1", "post.failed", { ...post, status: "failed" })).resolves.toBeUndefined();

    expect(prismaMock.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "w1" },
        data: expect.objectContaining({ lastError: expect.stringContaining("500") }),
      }),
    );
  });

  it("refuses to deliver to endpoints whose URL became invalid", async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: "w1", url: "http://169.254.169.254/latest", secret: "s1" },
    ]);

    await dispatchPostWebhooks("u1", "post.published", post);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastFailureAt: expect.any(Date) }),
      }),
    );
  });

  it("revalidates redirect targets before following them", async () => {
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: "s1" },
    ]);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: () => "http://127.0.0.1/private" },
    });

    await dispatchPostWebhooks("u1", "post.published", post);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.stringContaining("private") }),
      }),
    );
  });

  it("never throws even when the endpoint lookup fails", async () => {
    prismaMock.webhookEndpoint.findMany.mockRejectedValue(new Error("db down"));

    await expect(dispatchPostWebhooks("u1", "post.published", post)).resolves.toBeUndefined();
  });
});
