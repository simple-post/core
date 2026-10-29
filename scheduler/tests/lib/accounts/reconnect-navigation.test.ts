import { recoveryReturnPath, reconnectHref } from "@/lib/accounts/reconnect-navigation";

it.each([
  "https://evil.test",
  "//evil.test",
  String.raw`/\evil.test`,
  "/api/connect/x",
  "/posts/id/edit/extra",
  "/accounts\nLocation: https://evil.test",
])("rejects unsafe return destination %s", (value) => {
  expect(recoveryReturnPath(value)).toBeNull();
});
it("preserves editor destinations without allowing redirect query values to escape Accounts", () => {
  const href = reconnectHref("account&returnTo=//evil.test", "/posts/saved/edit");
  const url = new URL(href, "https://example.test");
  expect(url.pathname).toBe("/accounts");
  expect(url.searchParams.get("reconnect")).toBe("account&returnTo=//evil.test");
  expect(url.searchParams.get("returnTo")).toBe("/posts/saved/edit");
});
