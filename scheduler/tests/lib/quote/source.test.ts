import { prisma } from "@/lib/prisma";
import { assertNoUnresolvedQuotes, validateQuoteSource } from "@/lib/quote/source";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    post: {
      findFirst: jest.fn(),
    },
  },
}));

const findFirst = prisma.post.findFirst as jest.Mock;

describe("quote source validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accepts an already published source for immediate quotes", async () => {
    findFirst.mockResolvedValue({
      id: "source",
      status: "published",
      scheduledFor: null,
      accountResults: {},
      accounts: [],
    });

    await expect(
      validateQuoteSource({
        userId: "user",
        quotePostId: "source",
        postingMode: "now",
        scheduledFor: new Date(),
      }),
    ).resolves.toMatchObject({ id: "source" });
  });

  it("requires a quote of a scheduled source to be scheduled later", async () => {
    findFirst.mockResolvedValue({
      id: "source",
      status: "scheduled",
      scheduledFor: new Date("2026-07-10T10:00:00.000Z"),
      accountResults: null,
      accounts: [],
    });

    await expect(
      validateQuoteSource({
        userId: "user",
        quotePostId: "source",
        postingMode: "schedule",
        scheduledFor: new Date("2026-07-10T09:59:00.000Z"),
      }),
    ).rejects.toThrow("Schedule the quote after the post it quotes");

    await expect(
      validateQuoteSource({
        userId: "user",
        quotePostId: "source",
        postingMode: "schedule",
        scheduledFor: new Date("2026-07-10T10:01:00.000Z"),
      }),
    ).resolves.toMatchObject({ id: "source" });
  });

  it("prevents deleting a source while an unresolved quote depends on it", async () => {
    findFirst.mockResolvedValue({ id: "dependent-quote" });

    await expect(assertNoUnresolvedQuotes("user", "source")).rejects.toThrow(
      "This post is the source of a draft, scheduled, publishing, or retryable quote",
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          quotePostId: "source",
          status: { in: ["draft", "scheduled", "pending", "failed"] },
        }),
      }),
    );
  });
});
