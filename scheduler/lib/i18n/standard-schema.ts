import { z } from "zod";

import { schemaDisplay, schemaErrorMap } from "./schema-display";

import type { SourceCopy } from "./source-copy";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

/** Preserve the original validators and transforms; translate only their human presentation. */
export function localizeStandardSchema(schema: StandardSchemaWithJSON, copy: SourceCopy): StandardSchemaWithJSON {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      jsonSchema: {
        input: (options) => schemaDisplay(standard.jsonSchema.input(options), copy),
        output: (options) => schemaDisplay(standard.jsonSchema.output(options), copy),
      },
      validate: async (value, options) => {
        // Installed Zod exposes per-parse error maps; do not mutate its global configuration.
        if (schema instanceof z.ZodType) {
          const result = await schema.safeParseAsync(value, { error: schemaErrorMap(copy) });
          return result.success
            ? { value: result.data }
            : {
                issues: result.error.issues.map((issue) => ({ ...issue, message: copy(issue.message) })),
              };
        }
        const result = await standard.validate(value, options);
        return result.issues
          ? { issues: result.issues.map((issue) => ({ ...issue, message: copy(issue.message) })) }
          : result;
      },
    },
  };
}
