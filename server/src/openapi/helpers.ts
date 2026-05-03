import type {
  ZodOpenApiOperationObject,
  ZodOpenApiPathItemObject,
  ZodOpenApiResponseObject,
  ZodOpenApiSchemaObject,
} from "zod-openapi";

import { ApiErrorSchema } from "./schemas.js";

export type OpenApiMethod = "get" | "post";

export interface OpenApiRoute {
  path: string;
  methods: Partial<Record<OpenApiMethod, ZodOpenApiOperationObject>>;
}

export function defineRoute(route: OpenApiRoute): OpenApiRoute {
  return route;
}

export function jsonResponse(description: string, schema: ZodOpenApiSchemaObject): ZodOpenApiResponseObject {
  return {
    description,
    content: {
      "application/json": {
        schema,
      },
    },
  };
}

export function binaryResponse(description: string): ZodOpenApiResponseObject {
  return {
    description,
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" },
      },
    },
  };
}

export const apiKeySecurity: NonNullable<ZodOpenApiOperationObject["security"]> = [{ apiKeyAuth: [] }];

export const apiKeyErrorResponses = {
  "401": jsonResponse("Missing or invalid API key.", ApiErrorSchema),
};

export const basicErrorResponses = {
  "400": jsonResponse("Invalid request.", ApiErrorSchema),
  "500": jsonResponse("Unexpected server error.", ApiErrorSchema),
};

export const serverErrorResponses = {
  "500": jsonResponse("Unexpected server error.", ApiErrorSchema),
};

export function buildPaths(routes: OpenApiRoute[]): Record<string, ZodOpenApiPathItemObject> {
  return routes.reduce<Record<string, ZodOpenApiPathItemObject>>((paths, route) => {
    paths[route.path] = {
      ...(paths[route.path] ?? {}),
      ...route.methods,
    };
    return paths;
  }, {});
}
