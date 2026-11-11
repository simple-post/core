/* eslint-disable unicorn/no-await-expression-member -- Compact HTTP response assertions. */
import { NextRequest } from "next/server";

import { GET, PATCH } from "@/app/api/ui-preference/route";
import { cookieLocale, localeFromRequestHeaders, locales } from "@/lib/i18n/locales";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn(), update: jest.fn() } } }));
jest.mock("@/lib/middleware/auth", () => ({ requireBrowserSession: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireBrowserSession).mockResolvedValue({ user: { id: "owner" } } as never);
});
const request = (body: unknown, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/ui-preference", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
it("persists only the UI locale on the authenticated user", async () => {
  const response = await PATCH(request({ locale: "ar", userId: "other", timeZone: "Europe/Paris" }));
  expect(response.status).toBe(200);
  expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "owner" }, data: { uiLocale: "ar" } });
});
it.each(["unknown", "spa", null, 42])("rejects unsupported preference %s without writing", async (locale) => {
  expect((await PATCH(request({ locale }))).status).toBe(400);
  expect(prisma.user.update).not.toHaveBeenCalled();
});
it("rejects cross-origin writes before authentication and requires a browser session", async () => {
  expect((await PATCH(request({ locale: "ja" }, "https://other.example"))).status).toBe(403);
  expect(requireBrowserSession).not.toHaveBeenCalled();
  jest.mocked(requireBrowserSession).mockRejectedValue(new UnauthorizedError());
  expect((await PATCH(request({ locale: "ja" }))).status).toBe(401);
  expect(prisma.user.update).not.toHaveBeenCalled();
});
it("returns only the saved preference, and normalizes no-preference to null", async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ uiLocale: "zh-TW" } as never);
  expect(await (await GET(new NextRequest("http://localhost:3000/api/ui-preference"))).json()).toEqual({
    locale: "zh-Hant",
  });
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ uiLocale: null } as never);
  expect(await (await GET(new NextRequest("http://localhost:3000/api/ui-preference"))).json()).toEqual({
    locale: null,
  });
});
it("resolves cookie then saved preference then ranked browser languages without throwing on malformed cookies", () => {
  expect(localeFromRequestHeaders(new Headers({ cookie: "ui_locale=pt%2DBR", "accept-language": "ja" }), "ar")).toBe(
    "pt-BR",
  );
  expect(localeFromRequestHeaders(new Headers({ cookie: "ui_locale=%INVALID", "accept-language": "ja" }), "ar")).toBe(
    "ar",
  );
  expect(localeFromRequestHeaders(new Headers({ "accept-language": "fr;q=0.3,ja;q=0.9" }))).toBe("ja");
  expect(cookieLocale(new Headers({ cookie: "other=ar" }))).toBeUndefined();
});

it.each(locales)("uses browser language %s on the first visit and respects a later manual choice", (locale) => {
  expect(localeFromRequestHeaders(new Headers({ "accept-language": `${locale};q=1,en;q=0.2` }))).toBe(locale);
  expect(localeFromRequestHeaders(new Headers({ cookie: "ui_locale=bg", "accept-language": locale }))).toBe("bg");
});
