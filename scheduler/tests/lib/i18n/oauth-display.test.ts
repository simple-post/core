import { oauthError } from "@/lib/i18n/oauth-display";
import { serverMessage } from "@/lib/i18n/server";

jest.mock("@/lib/i18n/server-catalogs", () => ({
  serverCatalogs: { en: {}, ar: { "Unsupported scope(s): {{scopes}}": "نطاقات غير مدعومة: {{scopes}}" } },
}));

test("OAuth display copy preserves the existing error code, ASCII description and bearer challenge", async () => {
  const scopes = "posts:write, custom:write";
  const description = serverMessage("Unsupported scope(s): {{scopes}}", { scopes });
  const challenge = 'Bearer realm="SimplePost", error="invalid_scope"';
  const init = { status: 400, headers: { "WWW-Authenticate": challenge } };
  const [ar, en] = await Promise.all(
    ["ar", "en"].map(async (language) => {
      const response = oauthError(
        { headers: new Headers({ "Accept-Language": language }) },
        "invalid_scope",
        description,
        init,
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("WWW-Authenticate")).toBe(challenge);
      return response.json();
    }),
  );
  const protocol = { error: "invalid_scope", error_description: `Unsupported scope(s): ${scopes}` };
  expect(en).toEqual(protocol);
  expect(ar).toEqual({ ...protocol, message: `نطاقات غير مدعومة: ${scopes}` });
});
