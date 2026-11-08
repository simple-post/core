import { z } from "zod";

import { schemaDisplay, schemaErrorMap } from "@/lib/i18n/schema-display";
import { sourceCopy } from "@/lib/i18n/source-copy";

it("translates schema prose without changing property names or opaque object values", () => {
  const schema = {
    type: "object",
    description: "Help",
    properties: {
      description: { type: "string", title: "Description", enum: ["draft", "now"] },
      value: {
        const: { title: "exact", description: "exact" },
        default: { title: "exact" },
        examples: [{ description: "exact" }],
      },
    },
    allOf: [{ description: "Rule" }],
  };
  const localized = schemaDisplay(schema, (text) => `translated:${text}`);
  expect(localized.description).toBe("translated:Help");
  expect(localized.properties.description.title).toBe("translated:Description");
  expect(localized.properties.description.enum).toEqual(["draft", "now"]);
  expect(localized.properties.value).toEqual(schema.properties.value);
  expect(localized.allOf[0].description).toBe("translated:Rule");
  expect(schema.description).toBe("Help");
});

it("keeps validation translators per parse and does not include submitted values", () => {
  const schema = z.object({ text: z.string().min(2), mode: z.enum(["draft", "now"]) });
  const parse = (prefix: string) =>
    schema.safeParse(
      { text: "x", mode: "private-user-secret" },
      {
        error: schemaErrorMap((key, values) => prefix + sourceCopy(key, values)),
      },
    );
  for (const prefix of ["first:", "second:"]) {
    const result = parse(prefix);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.every((issue) => issue.message.startsWith(prefix))).toBe(true);
      expect(result.error.issues.map((issue) => issue.message).join(",")).not.toContain("private-user-secret");
      expect(result.error.issues[1].message).toContain('"draft", "now"');
    }
  }
  const original = schema.safeParse({ text: "x", mode: "draft" });
  if (!original.success) expect(original.error.issues[0].message).not.toMatch(/first:|second:/);
});
