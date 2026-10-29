/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { cleanup, render, screen } from "@testing-library/react";

import { TrialBanner } from "@/components/billing/trial-banner";

jest.mock("@/hooks/use-billing", () => ({
  useBillingStatus: () => ({
    data: {
      accessType: "trial",
      trial: {
        status: "active",
        expiresAt: "2026-11-29T14:00:00Z",
        daysRemaining: 30,
        postsPerPlatform: 5,
        platformUsage: {},
      },
    },
  }),
}));
afterEach(cleanup);
it("shows the actual expiry date as well as the countdown", () => {
  const { container } = render(createElement(TrialBanner));
  const date = container.querySelector("time")!;
  expect(date.dateTime).toBe("2026-11-29T14:00:00Z");
  expect(date.textContent).toBe(
    new Date(date.dateTime).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
  );
  expect(screen.getByRole("heading").textContent).toContain("30 days left");
});
