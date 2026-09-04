import { collectPostInput } from "../../src/lib/post/input.js";

describe("collectPostInput interactive mode", () => {
  it("shows only connected accounts and skips the review step", async () => {
    const prompt = {
      interactive: true,
      confirm: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      log: jest.fn(),
      multiSelect: jest.fn().mockResolvedValue(["account:x:main"]),
      text: jest.fn(async (message: string) => {
        switch (message) {
          case "Post text (optional)": {
            return "Hello world";
          }
          default: {
            return "";
          }
        }
      }),
    } as any;

    const result = await collectPostInput(
      {
        interactive: true,
      },
      prompt,
      {
        accounts: [
          {
            alias: "main",
            displayName: "Alice",
            platform: "x",
            source: "local",
            username: "alice",
          },
        ],
      },
    );

    expect(prompt.multiSelect).toHaveBeenCalledWith(
      "Which connected accounts should receive this post?",
      [
        expect.objectContaining({
          group: "Connected accounts",
          label: "X · main",
          value: "account:x:main",
        }),
      ],
      expect.objectContaining({ minSelections: 1 }),
    );
    expect(prompt.multiSelect.mock.invocationCallOrder[0]).toBeLessThan(prompt.text.mock.invocationCallOrder[0]);
    expect(result.accountSelections).toEqual({ x: ["main"] });
    expect(result.post.platforms).toEqual(["x"]);
    expect(result.post.content.text).toBe("Hello world");
    expect(prompt.select).toBeUndefined();
    expect(prompt.text).not.toHaveBeenCalledWith(expect.stringContaining("Log level"), expect.anything());
    expect(prompt.text).not.toHaveBeenCalledWith(expect.stringContaining("Strict mode"), expect.anything());
  });
});

describe("collectPostInput boolean flags", () => {
  it("preserves explicit true and false values from oclif boolean flags", async () => {
    const result = await collectPostInput(
      {
        account: ["youtube:main", "tiktok:main"],
        text: "Hello world",
        "strict-mode": false,
        "youtube-made-for-kids": false,
        "tiktok-allow-comment": true,
        "tiktok-allow-duet": false,
        "tiktok-allow-stitch": true,
      },
      {} as any,
      { accounts: [] },
    );

    expect(result.post.options?.common?.strictMode).toBe(false);
    expect(result.post.options?.youtube?.selfDeclaredMadeForKids).toBe(false);
    expect(result.post.options?.tiktok).toMatchObject({
      allowComment: true,
      allowDuet: false,
      allowStitch: true,
    });
  });
});

describe("collectPostInput Forem flags", () => {
  it("builds DEV/Forem article options from CLI flags", async () => {
    const result = await collectPostInput(
      {
        account: ["forem:main"],
        text: "# Release notes",
        "forem-title": "SimplePost 1.2",
        "forem-tags": "simplepost, sdk, release",
        "forem-published": false,
        "forem-canonical-url": "https://simple-post.io/blog/1-2",
      },
      {} as any,
      { accounts: [] },
    );

    expect(result.post.platforms).toEqual(["forem"]);
    expect(result.post.options?.forem).toEqual({
      title: "SimplePost 1.2",
      tags: ["simplepost", "sdk", "release"],
      published: false,
      canonicalUrl: "https://simple-post.io/blog/1-2",
    });
  });
});

describe("TikTok photo flags", () => {
  it.each([true, false])("preserves photo order, title, cover, and explicit auto music %s", async (autoAddMusic) => {
    const images = Array.from({ length: 7 }, (_, i) => `https://media.example.com/${i}.jpg`);
    const result = await collectPostInput(
      {
        account: ["tiktok:main"],
        image: images,
        "tiktok-auto-add-music": autoAddMusic,
        "tiktok-title": "Title",
        "tiktok-description": "Description",
        "tiktok-photo-cover-index": 0,
        "tiktok-privacy-level": "SELF_ONLY",
        "tiktok-publish-mode": "public",
      },
      {} as any,
      { accounts: [] },
    );
    expect(result.post.content.media?.map((item) => item.url)).toEqual(images);
    expect(result.post.options?.tiktok).toEqual({
      autoAddMusic,
      title: "Title",
      description: "Description",
      photoCoverIndex: 0,
      privacyLevel: "SELF_ONLY",
      publishMode: "public",
    });
  });
  it("supports inbox upload without a privacy choice", async () => {
    const result = await collectPostInput(
      { account: ["tiktok:main"], image: ["a.jpg", "b.jpg"], "tiktok-publish-mode": "draft" },
      {} as any,
      { accounts: [] },
    );
    expect(result.post.options?.tiktok).toEqual({ publishMode: "draft" });
    expect(result.post.content.media).toHaveLength(2);
  });
});

it.each(["public", "draft"])(
  "offers TikTok photo music/inbox settings for interactive app accounts (%s)",
  async (publishMode) => {
    const prompt = {
      interactive: true,
      log: jest.fn(),
      multiSelect: jest.fn().mockResolvedValue(["app:tt"]),
      confirm: jest.fn(async (message: string) => message !== "Add another media item?"),
      select: jest.fn(async (message: string) =>
        message === "Media type" ? "image" : message === "Publish mode" ? publishMode : "SELF_ONLY",
      ),
      text: jest.fn(async (message: string) =>
        message === "Path or URL"
          ? "https://media.example.com/1.jpg"
          : message.startsWith("Photo title")
            ? "Title"
            : "",
      ),
    } as any;
    const result = await collectPostInput({ interactive: true }, prompt, {
      accounts: [{ alias: "creator", appAccountId: "tt", platform: "tiktok", source: "app" }],
    });
    expect(result.appAccountIds).toEqual(["tt"]);
    expect(result.post.options?.tiktok).toEqual({
      publishMode,
      title: "Title",
      ...(publishMode === "public" ? { autoAddMusic: true, privacyLevel: "SELF_ONLY" } : {}),
    });
    expect(prompt.confirm.mock.calls.some(([message]: [string]) => message.includes("recommended music"))).toBe(
      publishMode === "public",
    );
  },
);
