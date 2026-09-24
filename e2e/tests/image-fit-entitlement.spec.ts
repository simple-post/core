import { test, expect } from "@playwright/test";
import { assertImageFitEntitlement } from "../src/image-fit-entitlement.js";
import { SchedulerApi } from "../src/http.js";
import type { Interface } from "../src/types.js";
import { config, serve, json } from "./helpers.js";

for (const iface of ["ui", "mcp", "cli-app", "cli-local"] as Interface[]) {
  test(`${iface}: ordinary scenarios do not request hosted features`, async () => {
    await assertImageFitEntitlement(
      {
        request: async () => {
          throw new Error("Unexpected feature request");
        },
      },
      {},
      iface,
    );
  });
}
for (const iface of ["cli-app", "cli-local"] as Interface[]) {
  test(`${iface}: local fitting does not require hosted entitlement`, async () => {
    await assertImageFitEntitlement(
      {
        request: async () => {
          throw new Error("Unexpected feature request");
        },
      },
      { imageFit: "blur" },
      iface,
    );
  });
}
for (const iface of ["ui", "mcp"] as Interface[]) {
  for (const response of [
    { name: "enabled", status: 200, body: { features: ["IMAGE_FITTING"] }, error: undefined },
    { name: "disabled", status: 200, body: { features: [] }, error: "needs IMAGE_FITTING enabled" },
    { name: "unauthorized", status: 401, body: { error: "Authentication required" }, error: "(401)" },
    { name: "forbidden", status: 403, body: { error: "Forbidden" }, error: "(403)" },
    { name: "absent route", status: 404, body: {}, error: "(404)" },
    { name: "invalid shape", status: 200, body: { features: "IMAGE_FITTING" }, error: "invalid" },
    { name: "null response", status: 200, body: null, error: "invalid" },
  ]) {
    test(`${iface}: hosted entitlement ${response.name}`, async () => {
      const calls: string[] = [];
      const server = await serve((req, res) => {
        calls.push(`${req.method} ${req.url}`);
        expect(req.headers.authorization).toBe("Bearer offline-feature-test");
        if (req.url === "/api/v1/accounts") return json(res, { accounts: [] });
        json(res, response.body, response.status);
      });
      const tokenEnv = "E2E_ENTITLEMENT_TEST_TOKEN";
      process.env[tokenEnv] = "offline-feature-test";
      try {
        const api = new SchedulerApi(config({ baseUrl: server.url, apiTokenEnv: tokenEnv }));
        // A deployment may accept established API routes but reject features.
        await api.request("/api/v1/accounts");
        const result = assertImageFitEntitlement(api, { imageFit: "crop" }, iface);
        if (response.error) await expect(result).rejects.toThrow(response.error);
        else await expect(result).resolves.toBeUndefined();
        expect(calls).toEqual(["GET /api/v1/accounts", "GET /api/v1/features"]);
      } finally {
        delete process.env[tokenEnv];
        await server.close();
      }
    });
  }
}
