import { test, expect } from "@playwright/test";
import { SchedulerApi } from "../src/http.js";
import { config, serve, json } from "./helpers.js";

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  test(`${method}: transient gateway retry is restricted to reads`, async () => {
    let calls = 0;
    const server = await serve((_req, res) =>
      json(res, { attempt: ++calls }, calls < 3 ? (calls === 1 ? 502 : 503) : 200),
    );
    process.env.E2E_API_TOKEN = "offline-test";
    try {
      const result = new SchedulerApi(config({ baseUrl: server.url })).request("/api/test", { method });
      if (method === "GET") {
        await expect(result).resolves.toEqual({ attempt: 3 });
        expect(calls).toBe(3);
      } else {
        await expect(result).rejects.toThrow("502");
        expect(calls).toBe(1);
      }
    } finally {
      delete process.env.E2E_API_TOKEN;
      await server.close();
    }
  });
}
for (const status of [504, 500, 401, 429]) {
  test(`GET ${status} preserves final error and bounds attempts`, async () => {
    let calls = 0;
    const server = await serve((_req, res) => {
      calls++;
      json(res, { error: "original gateway error" }, status);
    });
    process.env.E2E_API_TOKEN = "offline-test";
    try {
      await expect(new SchedulerApi(config({ baseUrl: server.url })).request("/api/test")).rejects.toThrow(`${status}`);
      expect(calls).toBe(status === 504 ? 3 : 1);
    } finally {
      delete process.env.E2E_API_TOKEN;
      await server.close();
    }
  });
}
