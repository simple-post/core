import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverAccounts, deploymentFingerprint, type Reader, type DiscoveredAccount } from "../src/discovery.js";
import { SchedulerApi } from "../src/http.js";
import { prepareMediaSources } from "../src/media.js";
import { loadConfig, selection } from "../src/config.js";
import { materialize, catalog } from "../src/catalog.js";
import { config, account, serve, json } from "./helpers.js";

const remote: DiscoveredAccount = {
  id: "tt-1",
  userId: "user-1",
  platform: "tiktok",
  platformAccountId: "open-1",
  username: null,
};
const noChoice = async () => {
  throw new Error("No choice should be necessary");
};
function reader(accounts = [remote]): Reader {
  return async <T>(route: string): Promise<T> =>
    (route === "/api/v1/accounts"
      ? { accounts }
      : {
          creatorInfo: {
            creatorUsername: "realhandle",
            privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            commentDisabled: false,
            duetDisabled: true,
            stitchDisabled: false,
            canPost: true,
            blockReason: null,
          },
        }) as T;
}
test("one-platform setup discovers ownership, real handle, and supported TikTok capabilities", async () => {
  const result = await discoverAccounts(reader(), ["tiktok"], [], undefined, noChoice);
  expect(result.userId).toBe("user-1");
  expect(Object.keys(result.accounts)).toEqual(["tiktok"]);
  expect(result.accounts.tiktok).toMatchObject({ id: "tt-1", username: "realhandle", apiUsername: null });
  expect(result.accounts.tiktok!.capabilities).toEqual([
    "privacy:PUBLIC_TO_EVERYONE",
    "privacy:SELF_ONLY",
    "allowComment",
    "allowStitch",
  ]);
});
test("discovered default audience is used for smoke cases without overriding explicit privacy regressions", () => {
  const a = account({ resources: { defaultPrivacyLevel: "SELF_ONLY" } });
  const smoke = materialize(catalog.find((s) => s.id === "tiktok.smoke")!, a, "ui", "r", "https://fixtures.invalid/");
  expect(smoke.options.privacyLevel).toBe("SELF_ONLY");
  const explicit = materialize(
    catalog.find((s) => s.id === "tiktok.image-privacy-public_to_everyone")!,
    a,
    "ui",
    "r",
    "https://fixtures.invalid/",
  );
  expect(explicit.options.privacyLevel).toBe("PUBLIC_TO_EVERYONE");
});
test("multiple connected accounts require an explicit choice and retain calibrated settings on refresh", async () => {
  const first = { ...remote, platform: "x" as const },
    second = { ...first, id: "second", platformAccountId: "another" };
  let choices = 0;
  const result = await discoverAccounts(reader([first, second]), ["x"], [], undefined, async (_question, options) => {
    choices++;
    expect(options).toHaveLength(2);
    return "second";
  });
  expect(choices).toBe(1);
  result.accounts.x!.observer.text = ".verified-caption";
  const cfg = config({ accounts: result.accounts });
  const refreshed = await discoverAccounts(reader([first, second]), ["x"], [], cfg, noChoice);
  expect(refreshed.accounts.x!.id).toBe("second");
  expect(refreshed.accounts.x!.observer.text).toBe(".verified-caption");
});
test("setup refuses another user and never picks an account outside the requested platform", async () => {
  await expect(
    discoverAccounts(reader([{ ...remote, userId: "different-user" }]), ["tiktok"], [], config(), noChoice),
  ).rejects.toThrow("different user");
  await expect(discoverAccounts(reader(), ["x"], ["tt-1"], undefined, noChoice)).rejects.toThrow("not available");
});
test("Pinterest board discovery selects the sole board without hand-entered IDs", async () => {
  const read: Reader = async <T>(route: string): Promise<T> =>
    (route === "/api/v1/accounts"
      ? { accounts: [{ ...remote, platform: "pinterest", username: "pinner" }] }
      : { boards: [{ id: "b-1", name: "Test board" }] }) as T;
  const result = await discoverAccounts(read, ["pinterest"], [], undefined, noChoice);
  expect(result.accounts.pinterest!.resources).toMatchObject({ boardId: "b-1", boardName: "Test board" });
});

test("YouTube setup discovers the actual channel and playlist through owner readback", async () => {
  const youtube: DiscoveredAccount = {
    ...remote,
    platform: "youtube",
    platformAccountId: "google-subject",
    username: null,
    displayName: "Channel owner",
  };
  const read: Reader = async <T>(route: string): Promise<T> =>
    (route === "/api/v1/accounts"
      ? { accounts: [youtube] }
      : {
          channels: [{ id: "UCactual", title: "Test channel" }],
          playlists: [{ id: "PLtest", title: "E2E playlist" }],
        }) as T;
  const result = await discoverAccounts(read, ["youtube"], [], undefined, noChoice);
  expect(result.accounts.youtube).toMatchObject({
    resources: {
      channelId: "UCactual",
      channelTitle: "Test channel",
      playlistId: "PLtest",
      playlistTitle: "E2E playlist",
    },
    observer: { profileUrl: "https://www.youtube.com/channel/UCactual", youtubeReadback: true },
  });
});
test("scheduler API reads reuse browser cookies without an API key and reject redirects", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-session-"));
  const server = await serve((req, res) => {
    expect(req.headers.cookie).toBe("test-session=logged-in");
    expect(req.headers.authorization).toBeUndefined();
    if (req.url === "/api/redirect") {
      res.writeHead(302, { location: "/login" });
      res.end();
    } else json(res, { accounts: [remote] });
  });
  try {
    const state = path.join(dir, "browser.json");
    await writeFile(
      state,
      JSON.stringify({
        cookies: [
          {
            name: "test-session",
            value: "logged-in",
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
    );
    const api = new SchedulerApi(
      config({ baseUrl: server.url, apiTokenEnv: "E2E_UNUSED_TEST_TOKEN", schedulerStorageState: state }),
    );
    expect((await api.request<{ accounts: DiscoveredAccount[] }>("/api/v1/accounts")).accounts).toHaveLength(1);
    await expect(api.request("/api/redirect")).rejects.toThrow("302");
  } finally {
    await server.close();
  }
});
test("automatic fixture staging uploads once, verifies bytes, and keeps reuse scoped to the test user", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-media-"));
  const bytes = await readFile(path.resolve("fixtures/generated/image.jpg"));
  let uploads = 0;
  const server = await serve((req, res) => {
    if (req.method === "POST") {
      expect(req.url).toBe("/api/v1/upload");
      uploads++;
      json(res, { url: `${server.url}/fixture.jpg`, size: bytes.length });
    } else {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(bytes);
    }
  });
  const oldToken = process.env.E2E_SETUP_TEST_TOKEN;
  process.env.E2E_SETUP_TEST_TOKEN = "fixture-test-token";
  try {
    const cfg = config({
      baseUrl: server.url,
      mediaBaseUrl: "https://fixtures.invalid/",
      mediaManifestFile: path.join(dir, "media.json"),
      apiTokenEnv: "E2E_SETUP_TEST_TOKEN",
    });
    const api = new SchedulerApi(cfg);
    await prepareMediaSources(cfg, ["image"], api);
    await prepareMediaSources(cfg, ["image"], api);
    expect(uploads).toBe(1);
    const file = path.join(dir, "config.json");
    await writeFile(file, JSON.stringify({ ...cfg, fixtureUrls: {} }));
    const loaded = loadConfig(file);
    expect(loaded.fixtureUrls["image.jpg"]).toBe(`${server.url}/fixture.jpg`);
    const thumbnail = materialize(
      catalog.find((c) => c.id === "youtube.thumbnail")!,
      account(),
      "mcp",
      "r",
      loaded.mediaBaseUrl,
      loaded.fixtureUrls,
    );
    expect(thumbnail.options.thumbnailUrl).toBe(`${server.url}/fixture.jpg`);
    await writeFile(file, JSON.stringify({ ...cfg, userId: "another-user" }));
    expect(() => loadConfig(file)).toThrow("different deployment or user");
  } finally {
    if (oldToken === undefined) delete process.env.E2E_SETUP_TEST_TOKEN;
    else process.env.E2E_SETUP_TEST_TOKEN = oldToken;
    await server.close();
  }
});
test("verification-only never stages missing media", async () => {
  const old = process.env.E2E_VERIFY_ONLY;
  process.env.E2E_VERIFY_ONLY = "1";
  try {
    const cfg = config({ mediaBaseUrl: "https://fixtures.invalid/" });
    await expect(prepareMediaSources(cfg, ["image"], new SchedulerApi(cfg))).rejects.toThrow("cannot upload");
  } finally {
    if (old === undefined) delete process.env.E2E_VERIFY_ONLY;
    else process.env.E2E_VERIFY_ONLY = old;
  }
});
test("scheduler discovery reuses the real CLI secret-store reader without a separate API key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-cli-session-"));
  const server = await serve((req, res) => {
    expect(req.headers.authorization).toBe("Bearer local-cli-test-token");
    json(res, { accounts: [remote] });
  });
  try {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        storage: { backend: "file-plain" },
        scheduler: { url: server.url, userId: "user-1", connectedAt: "2026-01-01" },
      }),
    );
    await writeFile(
      path.join(dir, "secrets.json"),
      JSON.stringify({ schemaVersion: 1, secrets: { "scheduler-token": { token: "local-cli-test-token" } } }),
    );
    const cfg = config({ baseUrl: server.url, cliConfigDir: dir, apiTokenEnv: "E2E_UNUSED_TEST_TOKEN" });
    expect(
      (await new SchedulerApi(cfg).request<{ accounts: DiscoveredAccount[] }>("/api/v1/accounts")).accounts,
    ).toHaveLength(1);
    await expect(
      new SchedulerApi({ ...cfg, baseUrl: "https://wrong-deployment.example" }).request("/api/v1/accounts"),
    ).rejects.toThrow("different deployment");
  } finally {
    await server.close();
  }
});
test("selection defaults to configured platforms and login path; explicit platform filtering still wins", async () => {
  const old = {
    config: process.env.E2E_CONFIG,
    platforms: process.env.E2E_PLATFORMS,
    interfaces: process.env.E2E_INTERFACES,
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), "simplepost-selection-"));
  const file = path.join(dir, "config.json");
  await writeFile(
    file,
    JSON.stringify(config({ accounts: { tiktok: account(), x: account() }, defaultInterfaces: ["ui"] })),
  );
  process.env.E2E_CONFIG = file;
  delete process.env.E2E_PLATFORMS;
  delete process.env.E2E_INTERFACES;
  try {
    expect(new Set(selection().platforms)).toEqual(new Set(["x", "tiktok"]));
    expect(selection().interfaces).toEqual(["ui"]);
    process.env.E2E_PLATFORMS = "tiktok";
    expect(selection().platforms).toEqual(["tiktok"]);
  } finally {
    for (const [key, value] of [
      ["E2E_CONFIG", old.config],
      ["E2E_PLATFORMS", old.platforms],
      ["E2E_INTERFACES", old.interfaces],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
test("deployment fingerprint is based on stable script assets, not page content or a claimed Git SHA", () => {
  expect(deploymentFingerprint('<script src="/a.js"></script>hello')).toBe(
    deploymentFingerprint('<script src="/a.js"></script>changed'),
  );
  expect(deploymentFingerprint('<script src="/a.js"></script>')).not.toBe(
    deploymentFingerprint('<script src="/b.js"></script>'),
  );
});
