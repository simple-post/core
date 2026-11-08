import { IMAGE_FIT_HELP } from "@simple-post/sdk";
import { z } from "zod";

import {
  createServerCopy,
  currentServerLocale,
  displayError,
  serverMessage,
  withServerLocale,
} from "@/lib/i18n/server";
import { localizeStandardSchema } from "@/lib/i18n/standard-schema";
import { locales } from "@/lib/i18n/locales";
import { validationDetails } from "@/lib/i18n/validation-display";
import { mcpRequestLocale, mcpUiLocale, withMcpLocale } from "@/lib/mcp/locale";
import { BadRequestError } from "@/lib/utils/errors";

it.each(locales.filter((locale) => locale !== "en"))("keeps retry parameter values in %s image-fit help", (locale) => {
  const result = validationDetails(
    { results: [], summary: { isValid: false, errors: [], warnings: [] }, imageFitHelp: IMAGE_FIT_HELP },
    locale,
  ) as { imageFitHelp: string };
  expect(result.imageFitHelp).not.toBe(IMAGE_FIT_HELP);
  for (const token of ["imageFit", "crop", "blur"]) {
    expect(result.imageFitHelp).toContain(token);
  }
});

it("isolates overlapping async requests and restores the caller context", async () => {
  const results = await Promise.all(
    ["ar", "ja"].map((locale) =>
      withMcpLocale(locale as "ar" | "ja", async () => {
        await Promise.resolve();
        return currentServerLocale();
      }),
    ),
  );
  expect(results).toEqual(["ar", "ja"]);
  expect(currentServerLocale()).toBe("en");
});
it("keeps original error messages canonical and never rewrites unmarked provider or user text", () => {
  const error = new BadRequestError(serverMessage("Missing {{field}}", { field: "raw العربية 日本語" }));
  expect(error.message).toBe("Missing raw العربية 日本語");
  expect(displayError(error, "ja")).toBe(error.message);
  const userText = new Error("raw العربية 日本語");
  expect(withServerLocale("ar", () => displayError(userText))).toBe(userText.message);
  const copy = createServerCopy("ar", { "Missing {{field}}": "marker {{field}}" });
  expect(copy("Missing {{field}}", { field: "raw العربية 日本語" })).toBe("marker raw العربية 日本語");
});
it("localizes schema prose without changing names, enum/example values, validation or transforms", async () => {
  const schema = z
    .object({
      description: z.enum(["draft", "published"]).describe("Status description"),
      title: z.string().min(3).describe("User title"),
    })
    .transform((value) => ({ ...value, derived: value.title.length }));
  const copy = createServerCopy("ja", {
    "Status description": "marker-status",
    "User title": "marker-title",
    "Use at least {{count, number}} characters.": "marker-min {{count, number}}",
  });
  const wrapped = localizeStandardSchema(schema, copy)["~standard"];
  const json = wrapped.jsonSchema.input({ target: "draft-2020-12" }) as {
    properties: Record<string, { description: string; enum?: string[] }>;
  };
  expect(Object.keys(json.properties)).toEqual(["description", "title"]);
  expect(json.properties.description.description).toBe("marker-status");
  expect(json.properties.description.enum).toEqual(["draft", "published"]);
  expect(await wrapped.validate({ description: "draft", title: "日本語", ignored: true })).toEqual({
    value: { description: "draft", title: "日本語", derived: 3 },
  });
  const invalid = await wrapped.validate({ description: "draft", title: "a" });
  expect(invalid.issues?.[0]).toMatchObject({ path: ["title"], message: "marker-min 3" });
  expect(schema.safeParse({ description: "draft", title: "a" }).success).toBe(false);
});
it("uses explicit MCP metadata before saved preferences and headers without consuming the request", async () => {
  const req = new Request("https://app.example/mcp", {
    method: "POST",
    headers: { "accept-language": "de" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: { _meta: { "openai/locale": "ja-JP" } } }),
  });
  expect(await mcpRequestLocale(req, "ar")).toBe("ja");
  expect(req.bodyUsed).toBe(false);
  expect(await req.json()).toMatchObject({ method: "tools/list" });
  expect(
    await mcpRequestLocale(new Request("https://app.example/mcp", { headers: { "accept-language": "de" } }), "ar"),
  ).toBe("ar");
  expect(mcpUiLocale({ mcpReq: { _meta: { locale: "bg" } } } as never, "ar")).toBe("bg");
});
