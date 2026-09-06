import { createHash } from "node:crypto";
import {
  interfaces,
  platforms,
  type Scenario,
  type Platform,
  type MediaKey,
  type Materialized,
  type Options,
  type Interface,
} from "./types.js";
import { selection, type Account } from "./config.js";
const all = [...interfaces];
const hosted: Interface[] = ["mcp", "ui"];
const cases: Scenario[] = [];
function add(platform: Platform, id: string, media: MediaKey[], options: Options = {}, extra: Partial<Scenario> = {}) {
  cases.push({ id: `${platform}.${id}`, platform, media, options, tags: ["full"], interfaces: all, ...extra });
}
const textPlatforms: Platform[] = ["x", "telegram", "facebook", "threads", "linkedin", "bluesky", "forem"];
const carouselPlatforms: Platform[] = ["x", "instagram", "facebook", "linkedin", "bluesky", "tiktok"];
for (const p of platforms) {
  const primary: MediaKey[] = p === "youtube" ? ["video"] : p === "forem" ? [] : ["image"];
  add(p, "smoke", primary, {}, { tags: ["smoke", "full"] });
  if (textPlatforms.includes(p))
    add(p, "text", [], {}, { message: "Hello from the live suite {token}\nUnicode café 日本語 🌻 #simplepost" });
  if (p !== "youtube" && p !== "forem") {
    add(p, "image-no-caption", ["image"], {}, { message: "" });
    add(p, "remote-image", ["image"], {}, { input: "remote", interfaces: ["mcp", "cli-app", "cli-local"] });
  }
  if (carouselPlatforms.includes(p)) add(p, "carousel", ["image", "image2"]);
  if (p !== "forem") {
    add(p, "video", ["video"]);
    add(p, "video-no-caption", ["silentVideo"], {}, { message: "" });
  }
  for (const mode of ["schedule", "draft-edit", "cancel"] as const)
    add(p, mode, primary, {}, { mode, interfaces: hosted, tags: ["full", "lifecycle"] });
  add(
    p,
    "empty-invalid",
    [],
    {},
    {
      message: "",
      expectedError: "content|text|media|video|image|empty|body",
      interfaces: ["mcp", "cli-app", "cli-local"],
      tags: ["full", "negative"],
    },
  );
}
for (const music of [true, false])
  for (const caption of ["omitted", "custom", "empty"] as const)
    for (const count of [1, 2]) {
      add(
        "tiktok",
        `photos-${count}-music-${music}-${caption}`,
        count === 1 ? ["image"] : ["image", "image2"],
        {
          autoAddMusic: music,
          ...(caption === "omitted"
            ? {}
            : { description: caption === "empty" ? "" : "Custom caption {token} #photos" }),
        },
        { tags: ["full", "regression"], expectedFields: { autoAddMusic: music } },
      );
    }
for (const privacyLevel of ["PUBLIC_TO_EVERYONE", "SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"]) {
  for (const media of [["image"], ["video"]] as MediaKey[][])
    add(
      "tiktok",
      `${media[0]}-privacy-${privacyLevel.toLowerCase()}`,
      media,
      { privacyLevel },
      { tags: ["full", "regression"], requirements: [`privacy:${privacyLevel}`] },
    );
}
add("tiktok", "music-omitted", ["image"], {}, { omitOptions: ["autoAddMusic"], tags: ["full", "regression"] });
add(
  "tiktok",
  "mcp-privacy-omitted",
  ["video"],
  {},
  {
    omitOptions: ["privacyLevel"],
    interfaces: ["mcp"],
    expectedFields: { privacyLevel: "PUBLIC_TO_EVERYONE" },
    tags: ["full", "regression"],
  },
);
add(
  "tiktok",
  "privacy-omitted",
  ["video"],
  {},
  {
    omitOptions: ["privacyLevel"],
    expectedError: "privacy",
    interfaces: ["cli-app", "cli-local"],
    tags: ["full", "negative"],
  },
);
for (const media of [["image", "image2"], ["video"]] as MediaKey[][])
  add(
    "tiktok",
    `inbox-${media[0]}`,
    media,
    { publishMode: "draft", autoAddMusic: false },
    { expectedFields: { lifecycle: "inbox" }, requirements: ["inbox-verification"] },
  );
add(
  "tiktok",
  "photo-cover-last",
  ["image", "image2"],
  { photoCoverIndex: 1 },
  { expectedFields: { photoCoverIndex: 1 } },
);
add("tiktok", "webp", ["webp"]);
add(
  "tiktok",
  "photos-35",
  Array.from({ length: 35 }, (_, i) => (i % 2 ? "image2" : "image")),
  {},
  { requirements: ["large-carousel"] },
);
add(
  "tiktok",
  "photos-36-invalid",
  Array.from({ length: 36 }, () => "image"),
  {},
  { expectedError: "35|media|photos", interfaces: ["mcp", "cli-app", "cli-local"], tags: ["full", "negative"] },
);
add(
  "tiktok",
  "mixed-invalid",
  ["image", "video"],
  {},
  { expectedError: "mix", interfaces: ["mcp", "cli-app", "cli-local"], tags: ["full", "negative"] },
);
add(
  "tiktok",
  "cover-invalid",
  ["image"],
  { photoCoverIndex: 1 },
  { expectedError: "cover|index", interfaces: ["mcp", "cli-app", "cli-local"], tags: ["full", "negative"] },
);
add("tiktok", "photo-title-90", ["image"], { title: "T".repeat(90) });
add(
  "tiktok",
  "photo-title-91-invalid",
  ["image"],
  { title: "T".repeat(91) },
  { expectedError: "90|title", interfaces: ["mcp", "cli-app", "cli-local"], tags: ["full", "negative"] },
);
add(
  "tiktok",
  "description-4001-invalid",
  ["image"],
  { description: "D".repeat(4001) },
  {
    expectedError: "4000|description|caption",
    interfaces: ["mcp", "cli-app", "cli-local"],
    tags: ["full", "negative"],
  },
);
for (const field of ["allowComment", "allowDuet", "allowStitch"])
  for (const value of [true, false])
    add(
      "tiktok",
      `${field}-${value}`,
      ["video"],
      { [field]: value },
      { expectedFields: { [field]: value }, requirements: value ? [field] : [] },
    );
for (const field of ["discloseYourBrand", "discloseBrandedContent"])
  add(
    "tiktok",
    field,
    ["image"],
    { commercialContentDisclosure: true, [field]: true },
    { expectedFields: { [field]: true }, requirements: ["commercial-disclosure"] },
  );
for (const privacyStatus of ["public", "private", "unlisted"])
  add("youtube", `privacy-${privacyStatus}`, ["video"], { privacyStatus }, { tags: ["full", "regression"] });
for (const made of [true, false])
  add(
    "youtube",
    `made-for-kids-${made}`,
    ["video"],
    { selfDeclaredMadeForKids: made },
    { expectedFields: { selfDeclaredMadeForKids: made } },
  );
add(
  "youtube",
  "metadata",
  ["video"],
  { title: "Video {token}", description: "Description {token}", tags: ["simplepost", "integration"], categoryId: "22" },
  { expectedFields: { tags: ["simplepost", "integration"], categoryId: "22" } },
);
add(
  "youtube",
  "playlist",
  ["video"],
  { playlistId: "$playlistId" },
  { requirements: ["resource:playlistId"], expectedFields: { playlistId: "$playlistId" } },
);
add(
  "youtube",
  "thumbnail",
  ["video"],
  { thumbnailUrl: "{mediaBaseUrl}/image.jpg" },
  { expectedFields: { thumbnailImage: "image" } },
);
for (const visibility of ["PUBLIC", "CONNECTIONS"])
  add(
    "linkedin",
    `visibility-${visibility.toLowerCase()}`,
    ["image"],
    { visibility },
    { tags: ["full", "regression"] },
  );
for (const parseMode of ["HTML", "Markdown", "MarkdownV2"])
  add(
    "telegram",
    `format-${parseMode.toLowerCase()}`,
    [],
    { parseMode },
    { message: parseMode === "HTML" ? "<b>Bold {token}</b>" : "*Bold {token}*", expectedFields: { format: "bold" } },
  );
for (const [kind, media] of Object.entries({
  photos: ["image", "image2"],
  videos: ["video", "silentVideo"],
  mixed: ["image", "video", "image2"],
}) as [string, MediaKey[]][]) {
  add("telegram", `album-${kind}`, media, {}, { tags: ["full", "regression"] });
  add("telegram", `album-${kind}-no-caption`, media, {}, { message: "", tags: ["full", "regression"] });
}
for (const parseMode of ["HTML", "Markdown", "MarkdownV2"])
  add(
    "telegram",
    `album-format-${parseMode.toLowerCase()}`,
    ["image", "image2"],
    { parseMode },
    {
      message: parseMode === "HTML" ? "<b>Bold {token}</b>" : "*Bold {token}*",
      expectedFields: { format: "bold" },
      tags: ["full", "regression"],
    },
  );
add(
  "telegram",
  "album-remote",
  ["image", "video", "image2"],
  {},
  {
    input: "remote",
    interfaces: ["mcp", "cli-app", "cli-local"],
    tags: ["full", "regression"],
  },
);
add(
  "telegram",
  "album-cli-json",
  ["image", "video", "image2"],
  {},
  {
    input: "json",
    interfaces: ["cli-app", "cli-local"],
    tags: ["full", "regression"],
  },
);
add(
  "telegram",
  "album-10",
  Array.from({ length: 10 }, (_, i) => (i % 2 ? "image2" : "image")),
  {},
  {
    tags: ["full", "regression"],
  },
);
add(
  "telegram",
  "album-11-invalid",
  Array.from({ length: 11 }, () => "image"),
  {},
  {
    expectedError: "10|media|album",
    interfaces: ["mcp", "cli-app", "cli-local"],
    tags: ["full", "negative"],
  },
);
for (const length of [1024, 1025])
  add(
    "telegram",
    `album-caption-${length}${length > 1024 ? "-invalid" : ""}`,
    ["image", "image2"],
    {},
    {
      message: "C".repeat(length),
      ...(length > 1024
        ? { expectedError: "1024|caption", interfaces: ["mcp", "cli-app", "cli-local"] as Interface[] }
        : {}),
      tags: length > 1024 ? ["full", "negative"] : ["full", "regression"],
    },
  );
add(
  "telegram",
  "album-reply",
  ["image", "video"],
  { replyTo: "$replyToId" },
  {
    interfaces: ["mcp", "cli-app", "cli-local"],
    requirements: ["resource:replyToId"],
    expectedFields: { replyTo: "$replyToId" },
    tags: ["full", "regression"],
  },
);
add(
  "telegram",
  "album-thread",
  ["image", "image2"],
  {},
  {
    interfaces: hosted,
    thread: ["Reply to album {token}"],
    tags: ["full", "regression"],
  },
);
for (const mode of ["schedule", "draft-edit", "cancel"] as const)
  add(
    "telegram",
    `album-${mode}`,
    ["image", "video", "image2"],
    {},
    {
      mode,
      interfaces: hosted,
      tags: ["full", "lifecycle", "regression"],
    },
  );
add("instagram", "mixed-carousel", ["image", "video"]);
add(
  "telegram",
  "album-mixed-flags",
  ["image", "image2", "video"],
  {},
  {
    input: "flags",
    interfaces: ["cli-app", "cli-local"],
    tags: ["full", "regression"],
  },
);
add(
  "bluesky",
  "video-invalid",
  ["image", "video"],
  {},
  {
    expectedError: "mix|mixed|cannot.*video",
    interfaces: ["mcp", "cli-app", "cli-local"],
    tags: ["full", "negative"],
  },
);
add(
  "bluesky",
  "two-videos-invalid",
  ["video", "silentVideo"],
  {},
  {
    expectedError: "one video|too_many_videos|video",
    interfaces: ["mcp", "cli-app", "cli-local"],
    tags: ["full", "negative"],
  },
);
for (const [id, media] of [
  ["carousel-images", ["image", "image2"]],
  ["carousel-videos", ["video", "silentVideo"]],
  ["carousel-mixed", ["image", "video"]],
] as [string, MediaKey[]][]) {
  add("threads", id, media, {}, { tags: ["full", "regression"] });
}
add(
  "pinterest",
  "metadata",
  ["image"],
  {
    title: "Pin {token}",
    description: "Pin description {token}",
    link: "https://example.com",
    altText: "Two dimensional color fixture",
  },
  { expectedFields: { link: "https://example.com", altText: "Two dimensional color fixture" } },
);
add(
  "pinterest",
  "board-missing-invalid",
  ["image"],
  {},
  {
    omitOptions: ["boardId"],
    expectedError: "board",
    interfaces: ["mcp", "cli-app", "cli-local"],
    tags: ["full", "negative"],
  },
);
add(
  "forem",
  "metadata",
  [],
  { title: "Article {token}", tags: ["testing", "webdev"], canonicalUrl: "https://example.com", published: true },
  { expectedFields: { tags: ["testing", "webdev"], canonicalUrl: "https://example.com" } },
);
add(
  "forem",
  "draft",
  [],
  { published: false },
  { expectedFields: { published: false }, requirements: ["draft-verification"] },
);
for (const key of ["series", "description", "organizationId"])
  add(
    "forem",
    key,
    [],
    { [key]: key === "organizationId" ? "$organizationId" : `${key} {token}` },
    {
      interfaces: ["mcp", "cli-app", "cli-local"],
      expectedFields: { [key]: key === "organizationId" ? "$organizationId" : `${key} {token}` },
      requirements: key === "organizationId" ? ["resource:organizationId"] : [],
    },
  );
for (const p of ["x", "telegram", "threads", "bluesky"] as Platform[])
  add(
    p,
    "thread",
    ["image"],
    {},
    { interfaces: hosted, thread: ["Second segment {token}", "Third segment {token}"], tags: ["full", "regression"] },
  );
for (const p of ["x", "threads"] as Platform[])
  add(
    p,
    "reply",
    [],
    { replyToId: "$replyToId" },
    {
      interfaces: p === "threads" ? ["mcp", "cli-app", "cli-local"] : all,
      requirements: ["resource:replyToId"],
      expectedFields: { replyToId: "$replyToId" },
    },
  );
add(
  "telegram",
  "reply",
  [],
  { replyTo: "$replyToId" },
  {
    interfaces: ["mcp", "cli-app", "cli-local"],
    requirements: ["resource:replyToId"],
    expectedFields: { replyTo: "$replyToId" },
  },
);
// Both forms must pass through the real CLI parser, not an imported workflow.
for (const p of platforms)
  add(
    p,
    "cli-json",
    p === "youtube" ? ["video"] : p === "forem" ? [] : ["image"],
    {},
    { interfaces: ["cli-app", "cli-local"], input: "json" },
  );
export const catalog: readonly Scenario[] = cases;
export function selectedCases(s = selection()) {
  const filter = s.filter?.startsWith("=") ? s.filter.slice(1) : s.filter;
  const exact = s.filter?.startsWith("=") ?? false;
  const selected = catalog.filter(
    (c) =>
      s.platforms.includes(c.platform) &&
      c.tags.includes(s.profile) &&
      (!filter || (exact ? c.id === filter : c.id.includes(filter))),
  );
  if (!selected.length) throw new Error("No scenarios match the selected profile/platform/filter.");
  return selected;
}
export function materialize(
  s: Scenario,
  account: Account,
  iface: Interface,
  run: string,
  mediaBaseUrl: string,
  fixtureUrls: Record<string, string> = {},
): Materialized {
  const token = "sp" + createHash("sha256").update(`${run}/${iface}/${s.id}`).digest("hex").slice(0, 16);
  const resolve = (v: Options[string]): Options[string] => {
    if (typeof v !== "string") return v;
    if (v.startsWith("$")) {
      const r = account.resources[v.slice(1)];
      if (r === undefined) throw new Error(`Missing ${s.platform} resource ${v}`);
      return r;
    }
    const resolved = v.replaceAll("{token}", token).replaceAll("{mediaBaseUrl}", mediaBaseUrl.replace(/\/$/, ""));
    return v.startsWith("{mediaBaseUrl}/") ? (fixtureUrls[v.slice("{mediaBaseUrl}/".length)] ?? resolved) : resolved;
  };
  const defaults: Options =
    s.platform === "telegram" && iface.startsWith("cli")
      ? { chatId: account.platformAccountId }
      : s.platform === "tiktok"
        ? {
            privacyLevel: account.resources.defaultPrivacyLevel ?? "PUBLIC_TO_EVERYONE",
            ...(s.media.every((x) => !x.toLowerCase().includes("video")) && s.media.length
              ? { autoAddMusic: false }
              : {}),
          }
        : s.platform === "youtube"
          ? { privacyStatus: "unlisted" }
          : s.platform === "forem"
            ? { title: `Article ${token}`, published: true }
            : s.platform === "pinterest"
              ? { boardId: account.resources.boardId ?? "" }
              : {};
  const options = Object.fromEntries(Object.entries({ ...defaults, ...s.options }).map(([k, v]) => [k, resolve(v)]));
  for (const key of s.omitOptions ?? []) delete options[key];
  const message = String(resolve(s.message ?? "Integration check {token} 🌻 #simplepost"));
  let expectedText = String(
    ["tiktok", "youtube", "pinterest"].includes(s.platform) ? (options.description ?? message) : message,
  );
  if (s.platform === "tiktok" && s.media.some((x) => x.toLowerCase().includes("video")))
    expectedText = String(options.title ?? message);
  if (s.platform === "telegram") expectedText = message.replace(/<\/?b>|\*/g, "");
  const expectedFields: Options = Object.fromEntries(
    Object.entries(s.expectedFields ?? {}).map(([k, v]) => [k, resolve(v)]),
  );
  if (s.platform === "tiktok" && options.publishMode !== "draft") {
    if (options.privacyLevel) expectedFields.privacyLevel = options.privacyLevel;
    if (s.media.length && s.media.every((x) => !x.toLowerCase().includes("video")))
      expectedFields.autoAddMusic = options.autoAddMusic ?? iface === "mcp";
  }
  if (s.platform === "youtube") expectedFields.privacyStatus = options.privacyStatus;
  if (s.platform === "linkedin" && options.visibility) expectedFields.visibility = options.visibility;
  return {
    ...s,
    options,
    token,
    message,
    expectedText,
    expectedFields,
    expectedTitle:
      s.platform === "tiktok" && s.media.every((x) => !x.toLowerCase().includes("video"))
        ? String(options.title ?? message.slice(0, 90).replace(/[\uD800-\uDBFF]$/, ""))
        : s.platform === "tiktok"
          ? undefined
          : s.platform === "youtube"
            ? String(options.title || message.trim() || "Untitled Video").slice(0, 100)
            : typeof options.title === "string"
              ? options.title
              : undefined,
    thread: s.thread?.map((x) => String(resolve(x))),
  };
}
