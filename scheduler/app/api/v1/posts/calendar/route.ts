import { type NextRequest, NextResponse } from "next/server";

import { PostsModel } from "@/lib/db";
import { requireAuth } from "@/lib/middleware/auth";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

// Range cap so a bad client can't request years of posts.
const MAX_RANGE_DAYS = 62;

function parseRangeValue(value: string | null, name: string): Date {
  if (!value) {
    throw new BadRequestError(`${name} is required.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError(`${name} must be a valid ISO 8601 datetime.`);
  }

  return date;
}

// GET /api/v1/posts/calendar - Non-draft posts scheduled inside [from, to),
// unpaginated, for the dashboard calendar.
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const from = parseRangeValue(searchParams.get("from"), "from");
    const to = parseRangeValue(searchParams.get("to"), "to");

    if (to <= from) {
      throw new BadRequestError("to must be after from.");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestError(`Calendar range must be at most ${MAX_RANGE_DAYS} days.`);
    }

    const repository = new PostsModel(session.user.id);
    const posts = await repository.getPostsBetween(from, to);
    return NextResponse.json({ posts });
  } catch (error) {
    return handleApiError(error);
  }
}
