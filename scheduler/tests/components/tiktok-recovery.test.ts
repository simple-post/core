import { createElement } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { TikTokRecoveryNotice, retryScheduleTimes } from "@/components/tiktok-recovery-notice";
import type { SocialPost } from "@/types";

function post(status = "failed", code = "spam_risk_too_many_pending_share"): SocialPost {
  return {
    id: "post",
    status: status as SocialPost["status"],
    message: "A saved video",
    media: [],
    accountIds: ["account"],
    scheduledFor: new Date("2099-10-25T09:00:00Z"),
    createdAt: new Date(),
    errorDetails: {
      failedPlatforms: [
        {
          platform: "tiktok",
          error: status === "scheduled" && code === "rate_limit_exceeded" ? "LOCAL_RATE_LIMIT" : "PUBLISH_REJECTED",
          details: { code },
        },
      ],
    },
  };
}
function render(posts: SocialPost[]) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: new QueryClient(),
      children: createElement(TikTokRecoveryNotice, { posts }),
    }),
  );
}
it("offers tomorrow and a chosen time, and explains inbox publishing", () => {
  const html = render([post()]);
  expect(html).toContain("Retry tomorrow");
  expect(html).toContain("Choose a time");
  expect(html).toContain("finish publishing");
  expect(html).toContain("does not provide an exact reset time");
});
it("shows a minute-limit wait without asking the user to retry", () => {
  const html = render([post("scheduled", "rate_limit_exceeded")]);
  expect(html).toContain("retry automatically");
  expect(html).not.toContain("Retry tomorrow");
});
it("offers to spread multiple originals across days", () => {
  expect(render([post(), { ...post(), id: "post-2" }])).toContain("Spread retries over days");
});
it("previews exactly the daily and hourly times that will be submitted", () => {
  const start = new Date(2026, 9, 25, 9);
  expect(retryScheduleTimes(start, 3, 24).map((time) => [time.getDate(), time.getHours()])).toEqual([
    [25, 9],
    [26, 9],
    [27, 9],
  ]);
  expect(retryScheduleTimes(start, 3, 1).map((time) => time.getHours())).toEqual([9, 10, 11]);
});
