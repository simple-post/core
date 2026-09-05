import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { ScheduleCalendar } from "@/components/schedule-calendar";
import { ScheduleCalendarProvider } from "@/components/schedule-calendar-context";
import { usePostingSlots } from "@/hooks/use-posting-slots";
import { useCalendarPosts } from "@/hooks/use-posts";
import type { SocialPost } from "@/types";

jest.mock("@/hooks/use-posting-slots", () => ({ usePostingSlots: jest.fn() }));
jest.mock("@/hooks/use-posts", () => ({ useCalendarPosts: jest.fn() }));

afterEach(() => jest.useRealTimers());

it("renders a separate post link for every post at the same time in compact and agenda views", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 7, 9));
  const scheduledFor = new Date(2026, 8, 7, 12);
  const posts: SocialPost[] = ["scheduled", "failed", "published"].map((status, index) => ({
    id: `post-${index}`,
    message: `Same-time post ${index}`,
    status: status as SocialPost["status"],
    scheduledFor,
    createdAt: new Date(2026, 8, 6),
    accountIds: [],
    media: [],
  }));
  jest.mocked(usePostingSlots).mockReturnValue({ data: [], isLoading: false } as never);
  jest.mocked(useCalendarPosts).mockReturnValue({ data: posts, isLoading: false } as never);

  const html = renderToStaticMarkup(
    createElement(ScheduleCalendarProvider, { children: createElement(ScheduleCalendar) }),
  );

  for (const post of posts) {
    // The week renders both the mobile agenda and the desktop compact calendar.
    expect(html.split(`href="/posts/${post.id}"`)).toHaveLength(3);
    expect(html).toContain(post.message);
  }
  expect(html).not.toContain("more at this time");
  expect(html).not.toContain("+2");
  expect(html).toContain("3 items");
});
