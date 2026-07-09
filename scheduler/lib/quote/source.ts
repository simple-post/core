import { prisma } from "@/lib/prisma";
import { BadRequestError } from "@/lib/utils/errors";

export type QuotePostingMode = "now" | "schedule" | "draft";

interface ValidateQuoteSourceOptions {
  userId: string;
  quotePostId?: string;
  postingMode: QuotePostingMode;
  scheduledFor: Date | null;
  currentPostId?: string;
}

/** Validates and returns the SimplePost source selected for a new quote. */
export async function validateQuoteSource(options: ValidateQuoteSourceOptions) {
  if (!options.quotePostId) return null;

  if (options.quotePostId === options.currentPostId) {
    throw new BadRequestError("A post cannot quote itself.");
  }

  const source = await prisma.post.findFirst({
    where: { id: options.quotePostId, userId: options.userId },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      accountResults: true,
      accounts: { select: { id: true, platform: true } },
    },
  });

  if (!source) {
    throw new BadRequestError("The post selected for quoting was not found.");
  }

  if (source.status === "published") {
    return source;
  }

  if (source.status !== "scheduled") {
    throw new BadRequestError("Only published posts and future scheduled posts can be quoted.");
  }

  if (options.postingMode === "now") {
    throw new BadRequestError("A scheduled post can only be quoted by a post scheduled after it is published.");
  }

  if (
    options.postingMode === "schedule" &&
    source.scheduledFor &&
    options.scheduledFor &&
    options.scheduledFor <= source.scheduledFor
  ) {
    throw new BadRequestError("Schedule the quote after the post it quotes is due to be published.");
  }

  return source;
}

export async function assertNoUnresolvedQuotes(userId: string, sourcePostId: string): Promise<void> {
  const dependent = await prisma.post.findFirst({
    where: {
      userId,
      quotePostId: sourcePostId,
      status: { in: ["draft", "scheduled", "pending", "failed"] },
    },
    select: { id: true },
  });

  if (dependent) {
    throw new BadRequestError(
      "This post is the source of a draft, scheduled, publishing, or retryable quote. Remove that quote first.",
    );
  }
}
