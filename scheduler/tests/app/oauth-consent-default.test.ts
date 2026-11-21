import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { OAuthConsent } from "@/app/oauth/authorize/oauth-consent";
import { UiLocaleProvider } from "@/lib/i18n/client";
import germanCopy from "@/lib/i18n/copy/de.json";

jest.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({ client_id: "client", redirect_uri: "https://example.com", state: "s", code_challenge: "c" }),
}));
jest.mock("@/lib/auth/use-login-session", () => ({
  useLoginSession: () => ({ data: { user: { name: "Reviewer", email: "review@example.com" } }, isPending: false }),
}));
jest.mock("@/lib/analytics/browser-events", () => ({ trackBrowserFunnelEvent: jest.fn() }));
jest.mock("@/components/login-form", () => ({ LoginForm: () => null }));
jest.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => createElement("button", null, children),
}));

it("preselects read/write and offers read-only for Muse", () => {
  const html = renderToStaticMarkup(createElement(OAuthConsent, { allowReadOnly: true }));
  const inputs = html.match(/<input[^>]*>/g) ?? [];
  expect(inputs).toHaveLength(2);
  expect(inputs.find((input) => input.includes('value="read_write"'))).toContain('checked=""');
  expect(inputs.find((input) => input.includes('value="read_only"'))).not.toContain('checked=""');
  expect(html).toContain("Choose access");
});

it("renders the original consent copy without access choices for every other client", () => {
  const html = renderToStaticMarkup(createElement(OAuthConsent, { allowReadOnly: false }));
  expect(html).not.toContain('name="access_mode"');
  expect(html).not.toContain("Choose access");
  expect(html).toContain("ChatGPT or another MCP client is requesting permission");
  expect(html).toContain(
    "Publishing now creates public content on the selected platforms. Review the tool-call details before approving.",
  );
});

it("keeps the existing consent localized for other clients", () => {
  const html = renderToStaticMarkup(
    createElement(UiLocaleProvider, {
      locale: "de",
      messages: germanCopy,
      children: createElement(OAuthConsent, { allowReadOnly: false }),
    }),
  );
  expect(html).toContain(germanCopy["Connect SimplePost"]);
  expect(html).toContain(germanCopy["Validate draft post text against platform rules"]);
  expect(html).not.toContain('name="access_mode"');
});
