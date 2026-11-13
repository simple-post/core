import { z } from "zod";

import { responseLocaleSchema } from "@/lib/preferences/plugin-language";

import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

export function withResponseLocale(schema: StandardSchemaWithJSON): StandardSchemaWithJSON {
  const standard = schema["~standard"];
  const enrich = (json: Record<string, unknown>) => ({
    ...json,
    properties: { ...(json.properties as object), response_locale: z.toJSONSchema(responseLocaleSchema) },
  });
  return {
    "~standard": {
      ...standard,
      jsonSchema: {
        input: (options) => enrich(standard.jsonSchema.input(options)),
        output: (options) => enrich(standard.jsonSchema.output(options)),
      },
      validate: async (input, options) => {
        const envelope = z.object({ response_locale: responseLocaleSchema }).passthrough().safeParse(input);
        if (!envelope.success) return { issues: envelope.error.issues };
        const { response_locale, ...args } = envelope.data;
        const parsed = await standard.validate(args, options);
        if (parsed.issues) return parsed;
        return { value: { ...(parsed.value as object), ...(response_locale ? { response_locale } : {}) } };
      },
    },
  };
}
