import type {
  ZodOpenApiOperationObject,
  ZodOpenApiPathItemObject,
  ZodOpenApiResponseObject,
  ZodOpenApiSchemaObject,
} from "zod-openapi";

import { ApiErrorSchema } from "./schemas";

export type OpenApiMethod = "get" | "post" | "patch" | "delete";

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

export function emptyResponse(description: string): ZodOpenApiResponseObject {
  return { description };
}

export function redirectResponse(description: string): ZodOpenApiResponseObject {
  return {
    description,
    headers: {
      Location: {
        description: "Redirect target URL.",
        schema: { type: "string", format: "uri" },
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

export const userAuthSecurity: NonNullable<ZodOpenApiOperationObject["security"]> = [
  { cookieAuth: [] },
  { cliBearerAuth: [] },
  { mcpBearerAuth: [] },
];

export const mcpAuthSecurity: NonNullable<ZodOpenApiOperationObject["security"]> = [{ mcpBearerAuth: [] }];

export const scheduledDispatchSecurity: NonNullable<ZodOpenApiOperationObject["security"]> = [
  { scheduledDispatchBearer: [] },
];

export const userAuthErrorResponses = {
  "401": jsonResponse("Authentication required.", ApiErrorSchema),
  "403": jsonResponse("Authenticated user does not have access to this resource.", ApiErrorSchema),
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
