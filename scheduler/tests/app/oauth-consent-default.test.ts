import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { OAuthConsent } from "@/app/oauth/authorize/oauth-consent";

jest.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({ client_id: "client", redirect_uri: "https://example.com", state: "s", code_challenge: "c" }),
}));
jest.mock("@/lib/auth/auth-client", () => ({
  useSession: () => ({ data: { user: { name: "Reviewer", email: "review@example.com" } }, isPending: false }),
}));
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
