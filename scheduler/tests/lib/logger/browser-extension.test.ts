import { isBrowserExtensionError } from "@/lib/logger/browser-extension";

describe("browser extension error filtering", () => {
  it.each([
    "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js",
    "moz-extension://05c0f6b7-7f9a/content.js",
    "safari-extension://com.example.extension/injected.js",
    "ms-browser-extension://example/content.js",
  ])("detects an extension event source: %s", (source) => {
    expect(isBrowserExtensionError(undefined, { source })).toBe(true);
  });

  it("detects the reported extension error", () => {
    const stack = [
      "TypeError: t is not a function",
      "    at t (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:17:27984)",
      "    at registerSolanaInjectedWallet (chrome-extension://fldfpgipfncgndfolcbkdeeknbbbnhcc/extensionPageScript.js:5822:10)",
    ].join("\n");

    expect(isBrowserExtensionError({ name: "TypeError", message: "t is not a function", stack })).toBe(true);
  });

  it("keeps application errors when an extension only appears later in the stack", () => {
    const stack = [
      "Error: Failed to publish",
      "    at publishPost (https://app.simplepost.social/_next/static/chunks/app.js:10:20)",
      "    at chrome-extension://example/content.js:1:2",
    ].join("\n");

    expect(isBrowserExtensionError({ message: "Failed to publish", stack })).toBe(false);
  });

  it("keeps normal application errors", () => {
    const error = new Error("Failed to publish");
    error.stack = "Error: Failed to publish\n    at publishPost (/app/publish.ts:10:20)";

    expect(isBrowserExtensionError(error, { source: "https://app.simplepost.social/publish" })).toBe(false);
  });
});
