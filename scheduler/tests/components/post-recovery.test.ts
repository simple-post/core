/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PostLinksModal } from "@/components/post-links-modal";
import type { PostingProgressResult } from "@/lib/posting/progress-client";

jest.mock("@/hooks/use-accounts", () => ({
  useAccounts: () => ({ data: [{ id: "failed", credentialStatus: { action: "reconnect" } }] }),
}));
const results: PostingProgressResult[] = [
  { accountId: "sent", platform: "linkedin", success: true },
  { accountId: "failed", platform: "instagram", success: false, error: "Your account connection has expired." },
];
afterEach(cleanup);

it("shows the failure without hovering and offers reconnect and edit actions", () => {
  const recover = jest.fn().mockReturnValue(false);
  render(
    createElement(PostLinksModal, {
      open: true,
      onOpenChange: jest.fn(),
      results,
      postId: "saved-post",
      onRecover: recover,
    }),
  );
  expect(screen.getByText("Your account connection has expired.").getAttribute("title")).toBeNull();
  const reconnect = screen.getByRole("link", { name: "Reconnect account" });
  const destination = new URL(reconnect.getAttribute("href")!, "https://example.test");
  expect(destination.searchParams.get("reconnect")).toBe("failed");
  expect(destination.searchParams.get("returnTo")).toBe("/posts/saved-post/edit");
  fireEvent.click(reconnect);
  expect(recover).toHaveBeenCalledWith("/posts/saved-post/edit", ["failed"]);
  expect(screen.getByRole("alert").textContent).toContain("edits could not be saved");
  expect(screen.getByRole("link", { name: "Edit and retry" }).getAttribute("href")).toBe("/posts/saved-post/edit");
});

it("does not offer recovery while another destination is still posting", () => {
  render(
    createElement(PostLinksModal, {
      open: true,
      onOpenChange: jest.fn(),
      results: [...results, { accountId: "pending", platform: "x" }],
      postId: "saved-post",
    }),
  );
  expect(screen.queryByRole("link", { name: "Reconnect account" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Edit and retry" })).toBeNull();
});

it("offers inspection instead of a retry when the publishing outcome is unknown", () => {
  render(
    createElement(PostLinksModal, {
      open: true,
      onOpenChange: jest.fn(),
      results: [{ accountId: "failed", platform: "x", success: false, uncertain: true }],
      onEditFailed: jest.fn(),
    }),
  );
  expect(screen.getByRole("link", { name: "Check Posts" }).getAttribute("href")).toBe("/?tab=past");
  expect(screen.queryByRole("button", { name: "Edit and retry" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Reconnect account" })).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("still asks users to inspect Posts if the final response is lost after all platform successes", () => {
  render(
    createElement(PostLinksModal, {
      open: true,
      onOpenChange: jest.fn(),
      outcomeUncertain: true,
      results: [{ accountId: "sent", platform: "linkedin", success: true }],
      onEditFailed: jest.fn(),
    }),
  );
  expect(screen.getByRole("link", { name: "Check Posts" })).toBeTruthy();
  expect(screen.getByText(/Final posting status could not be confirmed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit and retry" })).toBeNull();
});
