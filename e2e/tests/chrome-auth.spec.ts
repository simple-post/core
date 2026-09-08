import { test, expect, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromeAuth, installedChrome, saveAuthState } from "../src/chrome-auth.js";

test("failed session extraction preserves the previous authentication file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auth-state-"));
  const file = path.join(directory, "state.json");
  await writeFile(file, "previous-session");
  try {
    const context = {
      storageState: async () => {
        throw new Error("browser disconnected");
      },
    } as unknown as BrowserContext;
    await expect(saveAuthState(context, file)).rejects.toThrow("browser disconnected");
    expect(await readFile(file, "utf8")).toBe("previous-session");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved sessions replace the old file with owner-only permissions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auth-state-"));
  const file = path.join(directory, "state.json");
  await writeFile(file, "previous-session", { mode: 0o644 });
  const state = { cookies: [], origins: [] };
  const context = {
    storageState: async (options: unknown) => {
      expect(options).toEqual({ indexedDB: true });
      return state;
    },
  } as unknown as BrowserContext;
  try {
    await saveAuthState(context, file);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(state);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const save of [true, false])
  test(`installed Chrome manual session ${save ? "exports cookies and local storage" : "cancellation preserves previous state"}`, async () => {
    try {
      installedChrome();
    } catch {
      test.skip(true, "Installed Chrome is optional for offline checks");
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), "chrome-auth-"));
    const file = path.join(directory, "state.json");
    await writeFile(file, "previous-session");
    let ready!: () => void;
    const pageReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let requests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/ready") {
        response.end("ok");
        ready();
      } else {
        if (request.url === "/") requests++;
        response.writeHead(200, {
          "content-type": "text/html",
          "set-cookie": "test_session=local-fixture; HttpOnly; Path=/",
        });
        response.end(
          `<title>Local authentication test</title><p>Local fixture only; no social login.</p><script>localStorage.setItem("test-user", "fixture-user");
        const request = indexedDB.open("test-auth", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("session");
        request.onsuccess = () => {
          const transaction = request.result.transaction("session", "readwrite");
          transaction.objectStore("session").put("fixture-value", "test-key");
          transaction.oncomplete = () => { request.result.close(); fetch("/ready"); };
        };</script>`,
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const operation = chromeAuth(url, file, async (signal) => {
        // The page's script must run in ordinary Chrome before export attaches.
        await Promise.race([
          pageReady,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        ]);
        expect(await readFile(file, "utf8")).toBe("previous-session");
        if (!save) throw new Error("User cancelled");
      });
      if (!save) {
        await expect(operation).rejects.toThrow("User cancelled");
        expect(await readFile(file, "utf8")).toBe("previous-session");
      } else {
        await operation;
        const state = JSON.parse(await readFile(file, "utf8"));
        expect(state.cookies).toContainEqual(
          expect.objectContaining({ name: "test_session", value: "local-fixture", httpOnly: true }),
        );
        expect(state.origins).toContainEqual(
          expect.objectContaining({ origin: url, localStorage: [{ name: "test-user", value: "fixture-user" }] }),
        );
        expect(state.origins[0].indexedDB).toContainEqual(
          expect.objectContaining({
            name: "test-auth",
            stores: [
              expect.objectContaining({ name: "session", records: [{ key: "test-key", value: "fixture-value" }] }),
            ],
          }),
        );
        expect(requests).toBe(1);
      }
      await expect(stat(`${file}.chrome-profile.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
