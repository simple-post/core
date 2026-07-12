import { access, readFile } from "node:fs/promises";

import { PlatformSchema, PostSchema } from "@simple-post/sdk";

import { parseAccountSelections } from "../credentials.js";

import type { AccountPlatform } from "../account/platforms.js";
import type { AccountSelections } from "../credentials.js";
import type { PromptSession } from "../ux/prompt.js";
import type { Platform, Post, PostOptions } from "@simple-post/sdk";

interface InteractiveAccount {
  alias: string;
  displayName?: string;
  platform: AccountPlatform;
  source: "local" | "app";
  userId?: string;
  username?: string;
  /** App account ID for scheduler accounts */
  appAccountId?: string;
}

interface InteractiveTargetOption {
  alias?: string;
  appAccountId?: string;
  description: string;
  group: string;
  label: string;
  platform: Platform;
  source: "local" | "app";
  type: "account";
  value: string;
}

export type PostFlagValues = {
  interactive?: boolean;
  account?: string[];
  "app-account-id"?: string[];
  text?: string;
  image?: string[];
  video?: string[];
  "media-json"?: string;
  "post-json"?: string;
  "options-json"?: string;
  "log-level"?: string;
  "strict-mode"?: boolean;
  "x-reply-to-id"?: string;
  "telegram-chat-id"?: string;
  "telegram-parse-mode"?: string;
  "youtube-tags"?: string;
  "youtube-category-id"?: string;
  "youtube-playlist-id"?: string;
  "youtube-made-for-kids"?: boolean;
  "youtube-publish-at"?: string;
  "youtube-privacy-status"?: string;
  "facebook-publish-at"?: string;
  "tiktok-publish-mode"?: string;
  "tiktok-visibility"?: string;
  "tiktok-allow-comment"?: boolean;
  "tiktok-allow-duet"?: boolean;
  "tiktok-allow-stitch"?: boolean;
  "linkedin-visibility"?: string;
  "pinterest-board-id"?: string;
  "pinterest-title"?: string;
  "pinterest-description"?: string;
  "pinterest-link"?: string;
  "pinterest-alt-text"?: string;
  "slack-channel-id"?: string;
  "slack-thread-ts"?: string;
  "slack-reply-broadcast"?: boolean;
  "slack-mrkdwn"?: boolean;
  "slack-unfurl-links"?: boolean;
  "slack-unfurl-media"?: boolean;
};

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function parseJsonInput(raw: string): Promise<unknown> {
  try {
    await access(raw);
    const contents = await readFile(raw, "utf8");
    return JSON.parse(contents);
  } catch {
    return JSON.parse(raw);
  }
}

function inferPlatformsFromAccountSelections(selections: AccountSelections): Platform[] {
  return PlatformSchema.options.filter((platform) => (selections[platform]?.length ?? 0) > 0);
}

function buildOptions(flags: PostFlagValues): PostOptions | undefined {
  const options: PostOptions = {};
  const strictMode = flags["strict-mode"];
  if (flags["log-level"] || strictMode !== undefined) {
    options.common = {
      ...(flags["log-level"] ? { logLevel: flags["log-level"] as NonNullable<PostOptions["common"]>["logLevel"] } : {}),
      ...(strictMode === undefined ? {} : { strictMode }),
    };
  }

  if (flags["x-reply-to-id"]) {
    options.x = { ...options.x, replyToId: flags["x-reply-to-id"] };
  }

  if (flags["telegram-chat-id"] || flags["telegram-parse-mode"]) {
    options.telegram = {
      chatId: flags["telegram-chat-id"] ?? "",
      ...(flags["telegram-parse-mode"]
        ? { parseMode: flags["telegram-parse-mode"] as NonNullable<PostOptions["telegram"]>["parseMode"] }
        : {}),
    };
  }

  const youtubeTags = flags["youtube-tags"]
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (
    youtubeTags?.length ||
    flags["youtube-category-id"] ||
    flags["youtube-playlist-id"] ||
    flags["youtube-made-for-kids"] !== undefined ||
    flags["youtube-publish-at"] ||
    flags["youtube-privacy-status"]
  ) {
    options.youtube = {
      ...(youtubeTags?.length ? { tags: youtubeTags } : {}),
      ...(flags["youtube-category-id"] ? { categoryId: flags["youtube-category-id"] } : {}),
      ...(flags["youtube-playlist-id"] ? { playlistId: flags["youtube-playlist-id"] } : {}),
      ...(flags["youtube-made-for-kids"] === undefined
        ? {}
        : { selfDeclaredMadeForKids: flags["youtube-made-for-kids"] }),
      ...(flags["youtube-publish-at"] ? { publishAt: flags["youtube-publish-at"] } : {}),
      ...(flags["youtube-privacy-status"]
        ? {
            privacyStatus: flags["youtube-privacy-status"] as NonNullable<PostOptions["youtube"]>["privacyStatus"],
          }
        : {}),
    };
  }

  if (
    flags["slack-channel-id"] ||
    flags["slack-thread-ts"] ||
    flags["slack-reply-broadcast"] !== undefined ||
    flags["slack-mrkdwn"] !== undefined ||
    flags["slack-unfurl-links"] !== undefined ||
    flags["slack-unfurl-media"] !== undefined
  ) {
    options.slack = {
      channelId: flags["slack-channel-id"] ?? "",
      ...(flags["slack-thread-ts"] ? { threadTs: flags["slack-thread-ts"] } : {}),
      ...(flags["slack-reply-broadcast"] === undefined ? {} : { replyBroadcast: flags["slack-reply-broadcast"] }),
      ...(flags["slack-mrkdwn"] === undefined ? {} : { mrkdwn: flags["slack-mrkdwn"] }),
      ...(flags["slack-unfurl-links"] === undefined ? {} : { unfurlLinks: flags["slack-unfurl-links"] }),
      ...(flags["slack-unfurl-media"] === undefined ? {} : { unfurlMedia: flags["slack-unfurl-media"] }),
    };
  }

  if (flags["facebook-publish-at"]) {
    options.facebook = { publishAt: flags["facebook-publish-at"] };
  }

  if (
    flags["tiktok-publish-mode"] ||
    flags["tiktok-visibility"] ||
    flags["tiktok-allow-comment"] !== undefined ||
    flags["tiktok-allow-duet"] !== undefined ||
    flags["tiktok-allow-stitch"] !== undefined
  ) {
    options.tiktok = {
      ...(flags["tiktok-publish-mode"]
        ? { publishMode: flags["tiktok-publish-mode"] as NonNullable<PostOptions["tiktok"]>["publishMode"] }
        : {}),
      ...(flags["tiktok-visibility"]
        ? { visibility: flags["tiktok-visibility"] as NonNullable<PostOptions["tiktok"]>["visibility"] }
        : {}),
      ...(flags["tiktok-allow-comment"] === undefined ? {} : { allowComment: flags["tiktok-allow-comment"] }),
      ...(flags["tiktok-allow-duet"] === undefined ? {} : { allowDuet: flags["tiktok-allow-duet"] }),
      ...(flags["tiktok-allow-stitch"] === undefined ? {} : { allowStitch: flags["tiktok-allow-stitch"] }),
    };
  }

  if (flags["linkedin-visibility"]) {
    options.linkedin = {
      visibility: flags["linkedin-visibility"] as NonNullable<PostOptions["linkedin"]>["visibility"],
    };
  }

  if (
    flags["pinterest-board-id"] ||
    flags["pinterest-title"] ||
    flags["pinterest-description"] ||
    flags["pinterest-link"] ||
    flags["pinterest-alt-text"]
  ) {
    options.pinterest = {
      boardId: flags["pinterest-board-id"] ?? "",
      ...(flags["pinterest-title"] ? { title: flags["pinterest-title"] } : {}),
      ...(flags["pinterest-description"] ? { description: flags["pinterest-description"] } : {}),
      ...(flags["pinterest-link"] ? { link: flags["pinterest-link"] } : {}),
      ...(flags["pinterest-alt-text"] ? { altText: flags["pinterest-alt-text"] } : {}),
    };
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  youtube: "YouTube",
  telegram: "Telegram",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  bluesky: "Bluesky",
  threads: "Threads",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  slack: "Slack",
};

function getPlatformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

function buildInteractiveTargetOptions(options: {
  accounts: InteractiveAccount[];
  selectedAccounts: AccountSelections;
}): { defaultValues: string[]; options: InteractiveTargetOption[] } {
  const targetOptions: InteractiveTargetOption[] = [];
  const hasLocal = options.accounts.some((a) => a.source === "local");
  const hasApp = options.accounts.some((a) => a.source === "app");
  const showGroups = hasLocal && hasApp;

  for (const account of options.accounts) {
    const handle = account.username ? `@${account.username}` : account.alias;
    const displayName = account.displayName ?? "";
    const description = displayName ? `${handle} · ${displayName}` : handle;

    if (account.source === "app" && account.appAccountId) {
      targetOptions.push({
        appAccountId: account.appAccountId,
        description,
        group: showGroups ? "App accounts" : "Connected accounts",
        label: `${getPlatformLabel(account.platform)} · ${account.displayName || account.username || account.alias}`,
        platform: account.platform,
        source: "app",
        type: "account",
        value: `app:${account.appAccountId}`,
      });
    } else {
      targetOptions.push({
        alias: account.alias,
        description,
        group: showGroups ? "Local accounts" : "Connected accounts",
        label: `${getPlatformLabel(account.platform)} · ${account.alias}`,
        platform: account.platform,
        source: "local",
        type: "account",
        value: `account:${account.platform}:${account.alias}`,
      });
    }
  }

  const defaultValues = new Set<string>();

  for (const option of targetOptions) {
    if (option.source === "local") {
      const aliases = options.selectedAccounts[option.platform] ?? [];
      if (option.alias && aliases.includes(option.alias)) {
        defaultValues.add(option.value);
      }
    }
  }

  return {
    defaultValues: [...defaultValues],
    options: targetOptions,
  };
}

function resolveInteractiveTargets(
  selectedValues: string[],
  targetOptions: InteractiveTargetOption[],
): { accountSelections: AccountSelections; appAccountIds: string[]; platforms: Platform[] } {
  const selectedOptions = selectedValues.map((value) => {
    const option = targetOptions.find((candidate) => candidate.value === value);
    if (!option) {
      throw new Error(`Unknown interactive target selection: ${value}`);
    }

    return option;
  });

  const platforms: Platform[] = [];
  const usedPlatforms = new Set<Platform>();
  const accountSelections: AccountSelections = {};
  const appAccountIds: string[] = [];

  for (const option of selectedOptions) {
    if (!usedPlatforms.has(option.platform)) {
      usedPlatforms.add(option.platform);
      platforms.push(option.platform);
    }

    if (option.source === "app" && option.appAccountId) {
      appAccountIds.push(option.appAccountId);
    } else if (option.alias) {
      accountSelections[option.platform] = [...(accountSelections[option.platform] ?? []), option.alias];
    }
  }

  return { accountSelections, appAccountIds, platforms };
}

function logInteractiveSection(prompt: PromptSession, title: string, description?: string): void {
  prompt.log("");
  prompt.log(title);
  if (description) {
    prompt.log(description);
  }
  prompt.log("");
}

function filterOptionsForPlatforms(options: PostOptions | undefined, platforms: Platform[]): PostOptions | undefined {
  if (!options) {
    return undefined;
  }

  const filtered: PostOptions = {};
  if (options.common) {
    filtered.common = structuredClone(options.common);
  }

  for (const platform of platforms) {
    const platformOptions = options[platform];
    if (platformOptions) {
      (filtered as Record<string, unknown>)[platform] = structuredClone(platformOptions);
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function describeMedia(media: NonNullable<Post["content"]["media"]>): string {
  if (media.length === 0) {
    return "none";
  }

  const imageCount = media.filter((entry) => entry.type === "image").length;
  const videoCount = media.length - imageCount;
  const parts: string[] = [];

  if (imageCount > 0) {
    parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }

  if (videoCount > 0) {
    parts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
  }

  return parts.join(", ");
}

function describePlatformSettings(options: PostOptions | undefined, platforms: Platform[]): string {
  if (!options) {
    return "none";
  }

  const parts: string[] = [];

  if (platforms.includes("x") && options.x?.replyToId) {
    parts.push("X reply target");
  }

  if (platforms.includes("telegram") && options.telegram?.chatId) {
    parts.push(`Telegram chat ${options.telegram.chatId}`);
  }

  if (
    platforms.includes("youtube") &&
    (options.youtube?.tags?.length ||
      options.youtube?.categoryId ||
      options.youtube?.playlistId ||
      options.youtube?.publishAt ||
      options.youtube?.privacyStatus)
  ) {
    parts.push("YouTube settings");
  }

  if (platforms.includes("facebook") && options.facebook?.publishAt) {
    parts.push("Facebook schedule");
  }

  if (platforms.includes("tiktok") && (options.tiktok?.publishMode || options.tiktok?.visibility)) {
    parts.push("TikTok settings");
  }

  if (platforms.includes("linkedin") && options.linkedin?.visibility) {
    parts.push("LinkedIn visibility");
  }

  if (platforms.includes("pinterest") && options.pinterest?.boardId) {
    parts.push(`Pinterest board ${options.pinterest.boardId}`);
  }

  return parts.length > 0 ? parts.join(", ") : "none";
}

async function collectInteractiveMedia(
  prompt: PromptSession,
  existingMedia: NonNullable<Post["content"]["media"]>,
): Promise<NonNullable<Post["content"]["media"]>> {
  if (existingMedia.length > 0) {
    prompt.log("");
    prompt.log(`Current media: ${describeMedia(existingMedia)}`);
    prompt.log("");
    if (await prompt.confirm("Keep the current media selection?", true)) {
      return structuredClone(existingMedia);
    }
  }

  const media: NonNullable<Post["content"]["media"]> = [];
  while (await prompt.confirm(media.length === 0 ? "Add media?" : "Add another media item?", false)) {
    const typeInput = await prompt.select("Media type", [
      { label: "Image", value: "image" },
      { label: "Video", value: "video" },
    ]);
    const source = (await prompt.text("Path or URL", { required: true })).trim();

    if (typeInput === "image") {
      const caption = (await prompt.text("Caption (optional)")).trim();
      media.push(
        isUrl(source)
          ? { type: "image", url: source, ...(caption ? { caption } : {}) }
          : { type: "image", path: source, ...(caption ? { caption } : {}) },
      );
      continue;
    }

    const title = (await prompt.text("Video title (optional)")).trim();
    const description = (await prompt.text("Video description (optional)")).trim();
    media.push(
      isUrl(source)
        ? { type: "video", url: source, ...(title ? { title } : {}), ...(description ? { description } : {}) }
        : { type: "video", path: source, ...(title ? { title } : {}), ...(description ? { description } : {}) },
    );
  }

  return media;
}

interface SelectedAccountInfo {
  alias: string;
  platform: Platform;
  userId?: string;
}

async function collectInteractivePlatformOptions(
  prompt: PromptSession,
  platforms: Platform[],
  existingOptions?: PostOptions,
  selectedAccounts?: SelectedAccountInfo[],
): Promise<PostOptions | undefined> {
  const currentOptions = filterOptionsForPlatforms(existingOptions, platforms);
  const currentSummary = describePlatformSettings(currentOptions, platforms);

  if (currentOptions && currentSummary !== "none") {
    prompt.log("");
    prompt.log(`Current platform settings: ${currentSummary}`);
    prompt.log("");
    if (await prompt.confirm("Keep the current platform-specific settings?", true)) {
      return currentOptions;
    }
  }

  const options: PostOptions = currentOptions?.common ? { common: structuredClone(currentOptions.common) } : {};

  if (platforms.includes("x") && (await prompt.confirm("Add X-specific options?", false))) {
    logInteractiveSection(prompt, "X", "Only the settings relevant to this post are shown here.");
    const replyToId = (
      await prompt.text("Reply to post ID (optional)", {
        defaultValue: currentOptions?.x?.replyToId,
      })
    ).trim();
    if (replyToId) {
      options.x = {
        ...options.x,
        replyToId,
      };
    }
  }

  if (platforms.includes("telegram")) {
    const telegramAccounts = selectedAccounts?.filter((a) => a.platform === "telegram" && a.userId) ?? [];
    const storedChatIds = telegramAccounts.map((a) => ({ alias: a.alias, chatId: a.userId! }));

    if (storedChatIds.length > 0) {
      const chatLabel =
        storedChatIds.length === 1
          ? `${storedChatIds[0].alias} (${storedChatIds[0].chatId})`
          : storedChatIds.map((c) => `${c.alias} (${c.chatId})`).join(", ");
      logInteractiveSection(prompt, "Telegram", `Post to connected chat(s): ${chatLabel}`);
      const useStoredChat = await prompt.confirm("Use the connected chat(s) for this post?", true);
      if (!useStoredChat) {
        const chatId = (
          await prompt.text("Chat ID", {
            defaultValue: currentOptions?.telegram?.chatId,
            required: true,
          })
        ).trim();
        options.telegram = { chatId };
      }
    } else {
      logInteractiveSection(prompt, "Telegram", "Telegram needs a chat ID for every post.");
      const chatId = (
        await prompt.text("Chat ID", {
          defaultValue: currentOptions?.telegram?.chatId,
          required: true,
        })
      ).trim();
      options.telegram = { chatId };
    }

    let parseMode: NonNullable<PostOptions["telegram"]>["parseMode"] | undefined;
    if (await prompt.confirm("Set a parse mode?", false)) {
      parseMode = await prompt.select<Exclude<NonNullable<PostOptions["telegram"]>["parseMode"], undefined>>(
        "Parse mode",
        [
          { label: "HTML", value: "HTML" },
          { label: "Markdown", value: "Markdown" },
          { label: "MarkdownV2", value: "MarkdownV2" },
        ],
        currentOptions?.telegram?.parseMode,
      );
    }
    if (parseMode) {
      const base = options.telegram ?? {};
      const chatId =
        (base as { chatId?: string }).chatId ?? (storedChatIds.length === 1 ? storedChatIds[0]!.chatId : undefined);
      options.telegram = {
        ...base,
        parseMode,
        ...(chatId ? { chatId } : {}),
      } as NonNullable<PostOptions["telegram"]>;
    }
  }

  if (platforms.includes("youtube") && (await prompt.confirm("Add YouTube-specific settings?", false))) {
    logInteractiveSection(prompt, "YouTube", "Only the most common publishing settings are shown here.");
    const tags = (
      await prompt.text("Tags (comma-separated, optional)", {
        defaultValue: currentOptions?.youtube?.tags?.join(", "),
      })
    ).trim();
    const categoryId = (
      await prompt.text("Category ID (optional)", {
        defaultValue: currentOptions?.youtube?.categoryId,
      })
    ).trim();
    const playlistId = (
      await prompt.text("Playlist ID (optional)", {
        defaultValue: currentOptions?.youtube?.playlistId,
      })
    ).trim();
    const publishAt = (
      await prompt.text("Publish at timestamp (optional)", {
        defaultValue: currentOptions?.youtube?.publishAt,
      })
    ).trim();
    const privacyStatus = await prompt.select(
      "Privacy status",
      [
        { label: "Skip", value: "skip" },
        { label: "Public", value: "public" },
        { label: "Private", value: "private" },
        { label: "Unlisted", value: "unlisted" },
      ],
      currentOptions?.youtube?.privacyStatus ?? "skip",
    );

    options.youtube = {
      ...(tags
        ? {
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          }
        : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(playlistId ? { playlistId } : {}),
      ...(publishAt ? { publishAt } : {}),
      ...(privacyStatus === "skip"
        ? {}
        : { privacyStatus: privacyStatus as NonNullable<PostOptions["youtube"]>["privacyStatus"] }),
    };
  }

  if (platforms.includes("facebook") && (await prompt.confirm("Schedule the Facebook post?", false))) {
    logInteractiveSection(prompt, "Facebook");
    const publishAt = (
      await prompt.text("Publish at timestamp (optional)", {
        defaultValue: currentOptions?.facebook?.publishAt,
      })
    ).trim();
    if (publishAt) {
      options.facebook = { publishAt };
    }
  }

  if (platforms.includes("tiktok") && (await prompt.confirm("Add TikTok-specific settings?", false))) {
    logInteractiveSection(prompt, "TikTok");
    const publishMode = await prompt.select(
      "Publish mode",
      [
        { label: "Skip", value: "skip" },
        { label: "Draft", value: "draft" },
        { label: "Public", value: "public" },
      ],
      currentOptions?.tiktok?.publishMode ?? "skip",
    );
    const visibility = await prompt.select(
      "Visibility",
      [
        { label: "Skip", value: "skip" },
        { label: "Public", value: "public" },
        { label: "Friends", value: "friends" },
        { label: "Private", value: "private" },
      ],
      currentOptions?.tiktok?.visibility ?? "skip",
    );

    options.tiktok = {
      ...(publishMode === "skip"
        ? {}
        : { publishMode: publishMode as NonNullable<PostOptions["tiktok"]>["publishMode"] }),
      ...(visibility === "skip" ? {} : { visibility: visibility as NonNullable<PostOptions["tiktok"]>["visibility"] }),
    };
  }

  if (platforms.includes("linkedin") && (await prompt.confirm("Add LinkedIn visibility settings?", false))) {
    logInteractiveSection(prompt, "LinkedIn");
    const visibility = await prompt.select(
      "Visibility",
      [
        { label: "PUBLIC", value: "PUBLIC" },
        { label: "CONNECTIONS", value: "CONNECTIONS" },
      ],
      currentOptions?.linkedin?.visibility,
    );
    options.linkedin = { visibility };
  }

  if (platforms.includes("pinterest")) {
    logInteractiveSection(prompt, "Pinterest", "Pinterest needs a board ID for every post.");
    const boardId = (
      await prompt.text("Board ID", {
        defaultValue: currentOptions?.pinterest?.boardId,
        required: true,
      })
    ).trim();
    let title = "";
    let description = "";
    let link = "";
    let altText = "";

    if (await prompt.confirm("Add Pinterest details?", false)) {
      title = (await prompt.text("Title (optional)", { defaultValue: currentOptions?.pinterest?.title })).trim();
      description = (
        await prompt.text("Description (optional)", {
          defaultValue: currentOptions?.pinterest?.description,
        })
      ).trim();
      link = (await prompt.text("Link URL (optional)", { defaultValue: currentOptions?.pinterest?.link })).trim();
      altText = (await prompt.text("Alt text (optional)", { defaultValue: currentOptions?.pinterest?.altText })).trim();
    }

    options.pinterest = {
      boardId,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(link ? { link } : {}),
      ...(altText ? { altText } : {}),
    };
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

async function askInteractivePost(
  prompt: PromptSession,
  availableAccounts: { accounts: InteractiveAccount[] },
  existingSelections: AccountSelections,
): Promise<{ accountSelections: AccountSelections; appAccountIds: string[]; post: Post }> {
  if (availableAccounts.accounts.length === 0) {
    throw new Error(
      'No connected accounts are available yet. Run "simplepost account add" or "simplepost connect" first.',
    );
  }

  const targetOptions = buildInteractiveTargetOptions({
    accounts: availableAccounts.accounts,
    selectedAccounts: existingSelections,
  });
  const selectedTargets = await prompt.multiSelect(
    "Which connected accounts should receive this post?",
    targetOptions.options,
    {
      defaultValues: targetOptions.defaultValues,
      minSelections: 1,
    },
  );
  const targetSelection = resolveInteractiveTargets(selectedTargets, targetOptions.options);

  // Only collect platform options for local accounts (app accounts are handled server-side)
  const localPlatforms = targetSelection.platforms.filter(
    (platform) =>
      (targetSelection.accountSelections[platform]?.length ?? 0) > 0 || targetSelection.appAccountIds.length === 0,
  );
  const selectedAccountInfos: SelectedAccountInfo[] = localPlatforms.flatMap((platform) => {
    const aliases = targetSelection.accountSelections[platform] ?? [];
    return aliases.map((alias) => {
      const account = availableAccounts.accounts.find((a) => a.platform === platform && a.alias === alias);
      return { alias, platform, userId: account?.userId };
    });
  });
  const text = (await prompt.text("Post text (optional)")).trim();
  const media = await collectInteractiveMedia(prompt, []);

  const hasLocalAccounts = Object.values(targetSelection.accountSelections).some(
    (aliases) => (aliases?.length ?? 0) > 0,
  );
  const postOptions = hasLocalAccounts
    ? await collectInteractivePlatformOptions(prompt, localPlatforms, undefined, selectedAccountInfos)
    : undefined;

  // For local accounts, we need platforms. For app-only, we just pass a dummy platforms list.
  const postPlatforms = hasLocalAccounts ? localPlatforms : targetSelection.platforms;

  return {
    accountSelections: targetSelection.accountSelections,
    appAccountIds: targetSelection.appAccountIds,
    post: PostSchema.parse({
      platforms: postPlatforms,
      content: {
        ...(text ? { text } : {}),
        ...(media.length > 0 ? { media } : {}),
      },
      ...(postOptions ? { options: filterOptionsForPlatforms(postOptions, postPlatforms) } : {}),
    }),
  };
}

function resolveAppAccountSelection(
  requestedIds: string[],
  accounts: InteractiveAccount[],
): { appAccountIds: string[]; platforms: Platform[] } {
  const appAccountIds: string[] = [];
  const platforms: Platform[] = [];

  for (const raw of requestedIds) {
    const id = raw.trim();
    if (!id) {
      throw new Error("Invalid empty --app-account-id value.");
    }

    if (appAccountIds.includes(id)) {
      throw new Error(`Duplicate --app-account-id selection "${id}".`);
    }

    const account = accounts.find((candidate) => candidate.source === "app" && candidate.appAccountId === id);
    if (!account) {
      throw new Error(
        `No SimplePost app account with ID "${id}" was found. Run "simplepost account" to list the available IDs.`,
      );
    }

    appAccountIds.push(id);
    if (!platforms.includes(account.platform)) {
      platforms.push(account.platform);
    }
  }

  return { appAccountIds, platforms };
}

async function buildPostFromFlags(
  flags: PostFlagValues,
  accountSelections: AccountSelections,
  appPlatforms: Platform[] = [],
): Promise<Post> {
  if (flags["post-json"]) {
    return PostSchema.parse(await parseJsonInput(flags["post-json"]));
  }

  const platforms = [...new Set([...inferPlatformsFromAccountSelections(accountSelections), ...appPlatforms])];
  if (platforms.length === 0) {
    throw new Error(
      "Choose at least one target with --account or --app-account-id, or provide a full payload with --post-json.",
    );
  }

  const media: NonNullable<Post["content"]["media"]> = [];

  for (const image of flags.image ?? []) {
    media.push(isUrl(image) ? { type: "image", url: image } : { type: "image", path: image });
  }

  for (const video of flags.video ?? []) {
    media.push(isUrl(video) ? { type: "video", url: video } : { type: "video", path: video });
  }

  if (flags["media-json"]) {
    const parsedMedia = await parseJsonInput(flags["media-json"]);
    if (!Array.isArray(parsedMedia)) {
      throw new TypeError("--media-json must parse to an array.");
    }

    media.push(...(parsedMedia as NonNullable<Post["content"]["media"]>));
  }

  let options = buildOptions(flags);
  if (flags["options-json"]) {
    const parsedOptions = await parseJsonInput(flags["options-json"]);
    options = { ...options, ...(parsedOptions as PostOptions) };
  }

  return PostSchema.parse({
    platforms,
    content: {
      ...(flags.text ? { text: flags.text } : {}),
      ...(media.length > 0 ? { media } : {}),
    },
    ...(options ? { options } : {}),
  });
}

export async function collectPostInput(
  flags: PostFlagValues,
  prompt: PromptSession,
  options: { accounts: InteractiveAccount[] },
): Promise<{ accountSelections: AccountSelections; appAccountIds: string[]; post: Post }> {
  const existingSelections = parseAccountSelections(flags.account);
  if (flags.interactive) {
    const interactive = await askInteractivePost(prompt, options, existingSelections);
    return {
      accountSelections: interactive.accountSelections,
      appAccountIds: interactive.appAccountIds,
      post: interactive.post,
    };
  }

  const appSelection = resolveAppAccountSelection(flags["app-account-id"] ?? [], options.accounts);
  return {
    accountSelections: existingSelections,
    appAccountIds: appSelection.appAccountIds,
    post: await buildPostFromFlags(flags, existingSelections, appSelection.platforms),
  };
}
