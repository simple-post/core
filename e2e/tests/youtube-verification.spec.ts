import { test, expect, type Browser } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { account, config, serve, json } from "./helpers.js";
import { materialize, catalog } from "../src/catalog.js";
import { mediaFiles } from "../src/media.js";
import { verifyYouTubeMetadata } from "../src/verification/youtube.js";
import { verifyOnPlatform } from "../src/verification/browser.js";
import { assertRequirements } from "../src/preflight.js";

const owner = account({
  resources: { channelId: "UCowner123" },
  observer: {
    profileUrl: "https://www.youtube.com/channel/UCowner123",
    youtubeReadback: true,
    open: [],
    fields: {},
  },
});
const scenario = materialize(
  catalog.find((s) => s.id === "youtube.privacy-private")!,
  owner,
  "mcp",
  "test",
  "https://media.example.com",
);
const receipt = { success: true, postId: "abcdefghijk" };
test("private preflight requires owner readback and a discovered channel before posting", () => {
  expect(() => assertRequirements(scenario, owner)).not.toThrow();
  expect(() => assertRequirements(scenario, { ...owner, resources: {} })).toThrow("BLOCKED before posting");
  expect(() =>
    assertRequirements(scenario, { ...owner, observer: { ...owner.observer, youtubeReadback: false } }),
  ).toThrow("BLOCKED before posting");
});
async function fixture() {
  const [media] = await mediaFiles(config(), scenario.media);
  return {
    id: receipt.postId,
    snippet: {
      channelId: "UCowner123",
      title: scenario.expectedTitle,
      description: scenario.expectedText,
      categoryId: "22",
    },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    fileDetails: {
      fileSize: String(media.size),
      durationMs: "4000",
      videoStreams: [{ widthPixels: 720, heightPixels: 1280 }],
    },
    contentDetails: { duration: "PT5S" },
    processingDetails: { processingStatus: "succeeded" },
  };
}
test("direct Google fallback checks actual channels.mine membership and requests owner-only media parts", async () => {
  const originalFetch = globalThis.fetch;
  const video = await fixture();
  let ownChannel = true;
  process.env.E2E_TEST_YOUTUBE_OWNER_TOKEN = "offline-token";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://www.googleapis.com");
    if (url.pathname.endsWith("/channels")) {
      expect(url.searchParams.get("mine")).toBe("true");
      return Response.json({ items: [{ id: ownChannel ? video.snippet.channelId : "UCother" }] });
    }
    expect(url.searchParams.get("id")).toBe(receipt.postId);
    expect(url.searchParams.get("part")).toContain("fileDetails,processingDetails");
    return Response.json({ items: [video] });
  };
  const directOwner = {
    ...owner,
    observer: { ...owner.observer, youtubeAccessTokenEnv: "E2E_TEST_YOUTUBE_OWNER_TOKEN" },
  };
  try {
    expect((await verifyYouTubeMetadata(scenario, directOwner, receipt, config())).privateMediaProof?.source).toBe(
      "direct-owner-google-api",
    );
    ownChannel = false;
    await expect(verifyYouTubeMetadata(scenario, directOwner, receipt, config())).rejects.toThrow(
      "own the exact video channel",
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.E2E_TEST_YOUTUBE_OWNER_TOKEN;
  }
});
test("YouTube tags ignore order but reject missing, extra and duplicate tags", async () => {
  const video = (await fixture()) as Awaited<ReturnType<typeof fixture>> & { snippet: { tags: string[] } };
  const s = { ...scenario, expectedFields: { ...scenario.expectedFields, tags: ["simplepost", "integration"] } };
  const server = await serve((_req, res) => json(res, { video }));
  process.env.E2E_API_TOKEN = "offline-test";
  try {
    const cfg = config({ baseUrl: server.url });
    video.snippet.tags = ["integration", "simplepost"];
    await expect(verifyYouTubeMetadata(s, owner, receipt, cfg)).resolves.toMatchObject({
      verifiedFields: ["privacyStatus", "tags"],
    });
    for (const tags of [["simplepost"], ["simplepost", "integration", "extra"], ["simplepost", "simplepost"]]) {
      video.snippet.tags = tags;
      await expect(verifyYouTubeMetadata(s, owner, receipt, cfg)).rejects.toThrow("membership and cardinality");
    }
  } finally {
    delete process.env.E2E_API_TOKEN;
    await server.close();
  }
});
test("private owner media proof rejects absent or wrong source, identity and processing data", async () => {
  let video: any = await fixture();
  const server = await serve((req, res) => {
    expect(req.method).toBe("GET");
    json(res, { video });
  });
  const cfg = config({ baseUrl: server.url });
  process.env.E2E_API_TOKEN = "offline-test";
  try {
    const proof = await verifyYouTubeMetadata(scenario, owner, receipt, cfg);
    expect(proof.privateMediaProof).toMatchObject({
      videoId: receipt.postId,
      channelId: "UCowner123",
      processingStatus: "succeeded",
      fileSize: Number(video.fileDetails.fileSize),
      widthPixels: 720,
      heightPixels: 1280,
    });
    const faults = [
      (v: any) => {
        v.id = "wrong1234567";
      },
      (v: any) => {
        v.snippet.channelId = "UCdifferent";
      },
      (v: any) => {
        v.snippet.title += "wrong";
      },
      (v: any) => {
        v.snippet.description += "wrong";
      },
      (v: any) => {
        v.status.privacyStatus = "unlisted";
      },
      (v: any) => {
        delete v.fileDetails;
      },
      (v: any) => {
        delete v.fileDetails.fileSize;
      },
      (v: any) => {
        v.fileDetails.fileSize = "123";
      },
      (v: any) => {
        v.fileDetails.fileSize = "NaN";
      },
      (v: any) => {
        delete v.fileDetails.durationMs;
      },
      (v: any) => {
        v.fileDetails.durationMs = "8000";
      },
      (v: any) => {
        v.fileDetails.videoStreams = [];
      },
      (v: any) => {
        v.fileDetails.videoStreams.push(v.fileDetails.videoStreams[0]);
      },
      (v: any) => {
        v.fileDetails.videoStreams[0].widthPixels = 1280;
      },
      (v: any) => {
        delete v.fileDetails.videoStreams[0].heightPixels;
      },
      (v: any) => {
        delete v.contentDetails;
      },
      (v: any) => {
        v.contentDetails.duration = "PT8S";
      },
      (v: any) => {
        delete v.processingDetails;
      },
      (v: any) => {
        v.processingDetails.processingStatus = "processing";
      },
      (v: any) => {
        v.processingDetails.processingStatus = "failed";
      },
    ];
    for (const mutate of faults) {
      video = await fixture();
      mutate(video);
      await expect(verifyYouTubeMetadata(scenario, owner, receipt, cfg)).rejects.toThrow();
    }
    video = await fixture();
    await expect(verifyYouTubeMetadata(scenario, owner, { success: true }, cfg)).rejects.toThrow();
    await expect(verifyYouTubeMetadata(scenario, { ...owner, resources: {} }, receipt, cfg)).rejects.toThrow();
  } finally {
    delete process.env.E2E_API_TOKEN;
    await server.close();
  }
});

for (const view of ["private", "private-modern", "public", "unlisted"] as const) {
  test(`${view} browser visit records owner proof only for private videos; visible frame still required otherwise`, async ({
    browser,
  }) => {
    const privacy = view === "private-modern" ? "private" : view;
    const video = await fixture();
    video.status.privacyStatus = privacy;
    const s = { ...scenario, expectedFields: { privacyStatus: privacy } };
    const server = await serve((_req, res) => json(res, { video }));
    const dir = await mkdtemp(path.join(os.tmpdir(), "youtube-proof-"));
    const cfg = config({ baseUrl: server.url, verifyTimeoutMs: 1 });
    process.env.E2E_API_TOKEN = "offline-test";
    let visits = 0;
    const isolated = {
      newContext: async (options: any) => {
        const context = await browser.newContext(options);
        await context.route("https://www.youtube.com/**", (route) => {
          visits++;
          return route.fulfill({
            contentType: "text/html",
            body:
              view === "private-modern"
                ? `<ytd-watch-flexy><div id="error-screen"><yt-player-interstitial-renderer>This video is private. Sign in.</yt-player-interstitial-renderer></div></ytd-watch-flexy>`
                : `<div id="movie_player"><div class="ytp-error-content-wrap">This video is private. Sign in.</div></div>`,
          });
        });
        return context;
      },
    } as Browser;
    try {
      if (privacy === "private") {
        await verifyOnPlatform(isolated, cfg, s, owner, receipt, dir);
        const observation = JSON.parse(await readFile(path.join(dir, `${s.token}-observed.json`), "utf8"));
        expect(observation).toMatchObject({
          verificationMode: "private-view/ownerAPI",
          publicVisualProof: false,
          browserPrivateNotice: "This video is private. Sign in.",
          youtubeOwnerMediaProof: { videoId: receipt.postId, processingStatus: "succeeded" },
        });
        expect(observation.url).toBe(`https://www.youtube.com/watch?v=${receipt.postId}`);
      } else {
        expect((await verifyYouTubeMetadata(s, owner, receipt, cfg)).privateMediaProof).toBeUndefined();
        await expect(verifyOnPlatform(isolated, cfg, s, owner, receipt, dir)).rejects.toThrow();
      }
      expect(visits).toBeGreaterThan(0);
    } finally {
      delete process.env.E2E_API_TOKEN;
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
