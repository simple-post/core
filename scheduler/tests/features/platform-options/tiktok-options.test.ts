import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { AccountOptionsComponent } from "@/features/platform-options/account-options";

jest.mock("@/hooks/use-accounts", () => ({
  useAccounts: () => ({ data: [{ id: "tt", platform: "tiktok", username: "creator" }], isLoading: false }),
}));

it.each(["public", "draft"])("renders TikTok photo controls for %s", (publishMode) => {
  const html = renderToStaticMarkup(
    createElement(AccountOptionsComponent, {
      selectedAccountIds: ["tt"],
      options: { tt: { publishMode, autoAddMusic: false } },
      onOptionsChange: jest.fn(),
      media: Array.from({ length: 7 }, (_, i) => ({
        id: String(i),
        url: `https://media.example/${i}.jpg`,
        filename: `${i}.jpg`,
        size: 1024,
        type: "image" as const,
      })),
    }),
  );
  expect(html).toContain("Cover photo");
  expect(html).toContain("Photo description");
  expect(html).toContain("90 characters");
  expect(html).toContain("add music and edit in TikTok before publishing manually");
  expect(html.includes("Automatically add music")).toBe(publishMode === "public");
});
