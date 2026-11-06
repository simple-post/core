import type { SourceCopy } from "./source-copy";
import type { z } from "zod";

/** Localize only JSON Schema prose; property names, enums and constraints stay canonical. */
export function schemaDisplay<T>(value: T, copy: SourceCopy): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const maps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
  const schemas = new Set([
    "items",
    "additionalItems",
    "contains",
    "additionalProperties",
    "unevaluatedProperties",
    "unevaluatedItems",
    "propertyNames",
    "not",
    "if",
    "then",
    "else",
    "contentSchema",
  ]);
  const arrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if ((key === "description" || key === "title") && typeof child === "string") return [key, copy(child)];
      if (maps.has(key) && child && typeof child === "object" && !Array.isArray(child)) {
        return [
          key,
          Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, schemaDisplay(schema, copy)])),
        ];
      }
      if (arrays.has(key) && Array.isArray(child)) return [key, child.map((schema) => schemaDisplay(schema, copy))];
      if (schemas.has(key))
        return [
          key,
          Array.isArray(child) ? child.map((schema) => schemaDisplay(schema, copy)) : schemaDisplay(child, copy),
        ];
      // const, enum, default and examples can contain arbitrary user/machine objects.
      return [key, child];
    }),
  ) as T;
}

/** Per-parse validation copy; never reads or echoes submitted values or changes global Zod state. */
export function schemaErrorMap(copy: SourceCopy): z.core.$ZodErrorMap {
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        switch (issue.expected) {
          case "string": {
            return copy("Expected text.");
          }
          case "number": {
            return copy("Expected a number.");
          }
          case "int": {
            return copy("Expected an integer.");
          }
          case "boolean": {
            return copy("Expected true or false.");
          }
          case "array": {
            return copy("Expected a list.");
          }
          case "object":
          case "record": {
            return copy("Expected an object.");
          }
          default: {
            return copy("Invalid value. Check the tool's input schema.");
          }
        }
      }
      case "too_small": {
        if (issue.origin === "string")
          return copy("Use at least {{count, number}} characters.", { count: Number(issue.minimum) });
        if (issue.origin === "array")
          return copy("Provide at least {{count, number}} items.", { count: Number(issue.minimum) });
        return issue.inclusive
          ? copy("Value must be at least {{minimum}}.", { minimum: String(issue.minimum) })
          : copy("Value must be greater than {{minimum}}.", { minimum: String(issue.minimum) });
      }
      case "too_big": {
        if (issue.origin === "string")
          return copy("Use at most {{count, number}} characters.", { count: Number(issue.maximum) });
        if (issue.origin === "array")
          return copy("Provide at most {{count, number}} items.", { count: Number(issue.maximum) });
        return issue.inclusive
          ? copy("Value must be at most {{maximum}}.", { maximum: String(issue.maximum) })
          : copy("Value must be less than {{maximum}}.", { maximum: String(issue.maximum) });
      }
      case "invalid_value": {
        return copy("Use one of these exact values: {{values}}.", {
          values: issue.values
            .map((value) => (typeof value === "bigint" ? String(value) : JSON.stringify(value)))
            .join(", "),
        });
      }
      case "unrecognized_keys": {
        return copy("Remove unrecognized fields: {{fields}}.", { fields: issue.keys.join(", ") });
      }
      case "invalid_format": {
        return issue.format === "url"
          ? copy("Enter a valid URL.")
          : issue.format === "datetime"
            ? copy("Enter a valid ISO 8601 date and time with a timezone.")
            : copy("Invalid format. Check the tool's input schema.");
      }
      case "not_multiple_of": {
        return copy("Value must be a multiple of {{divisor, number}}.", { divisor: issue.divisor });
      }
      default: {
        return copy("Invalid value. Check the tool's input schema.");
      }
    }
  };
}
