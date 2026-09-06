import { createHash } from "node:crypto";
import type { Account, LiveConfig } from "./config.js";
import type { Platform } from "./types.js";

export interface DiscoveredAccount {
  id: string;
  userId: string;
  platform: Platform;
  platformAccountId: string;
  username: string | null;
  displayName?: string | null;
  previewOnly?: boolean;
  credentialStatus?: { action?: string };
}
export type Reader = <T>(route: string) => Promise<T>;
export type Choose = (question: string, options: { id: string; label: string }[]) => Promise<string>;

export function deploymentFingerprint(html: string) {
  const assets = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]).sort();
  return assets.length
    ? "assets:" + createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 24)
    : "unreported-deployment";
}
export async function discoverAccounts(
  read: Reader,
  requested: Platform[] | undefined,
  chosenIds: string[],
  existing: LiveConfig | undefined,
  choose: Choose,
) {
  const response = await read<{ accounts: DiscoveredAccount[] }>("/api/v1/accounts");
  if (!response.accounts.length)
    throw new Error("No connected accounts. Connect a test social account on the site first.");
  const owners = [...new Set(response.accounts.map((a) => a.userId))];
  if (owners.length !== 1 || !owners[0] || (existing && existing.userId !== owners[0]))
    throw new Error(
      "Login belongs to a different user than the existing test configuration. Use a separate config for another test user.",
    );
  const selected = requested ?? [...new Set(response.accounts.map((a) => a.platform))];
  for (const id of chosenIds)
    if (!response.accounts.some((a) => a.id === id && selected.includes(a.platform)))
      throw new Error(`Selected account ${id} is not available for the requested platforms`);
  const accounts: LiveConfig["accounts"] = { ...existing?.accounts };
  const notes: string[] = [];
  for (const platform of selected) {
    const candidates = response.accounts.filter((a) => a.platform === platform && !a.previewOnly);
    if (!candidates.length) throw new Error(`No connected ${platform} account for the logged-in user`);
    const explicit = candidates.filter((a) => chosenIds.includes(a.id));
    if (explicit.length > 1) throw new Error(`Select one ${platform} account for this test configuration`);
    const prior = candidates.find((a) => a.id === existing?.accounts[platform]?.id);
    const id =
      explicit[0]?.id ??
      prior?.id ??
      (candidates.length === 1
        ? candidates[0].id
        : await choose(
            `Choose the ${platform} test account`,
            candidates.map((a) => ({ id: a.id, label: a.username ?? a.displayName ?? a.platformAccountId })),
          ));
    const actual = candidates.find((a) => a.id === id);
    if (!actual) throw new Error(`Invalid ${platform} account selection`);
    const old = existing?.accounts[platform]?.id === actual.id ? existing.accounts[platform] : undefined;
    const username = actual.username ?? actual.displayName ?? actual.platformAccountId;
    const handle = encodeURIComponent(username.replace(/^@/, ""));
    const profiles: Record<Platform, string> = {
      x: `https://x.com/${handle}`,
      telegram: /^[1-9]\d*$/.test(actual.platformAccountId) ? "https://web.telegram.org/" : `https://t.me/${handle}`,
      instagram: `https://www.instagram.com/${handle}/`,
      facebook: `https://www.facebook.com/${encodeURIComponent(actual.platformAccountId)}`,
      threads: `https://www.threads.com/@${handle}`,
      tiktok: `https://www.tiktok.com/@${handle}`,
      youtube: "https://www.youtube.com/",
      pinterest: `https://www.pinterest.com/${handle}/`,
      linkedin: "https://www.linkedin.com/",
      bluesky: `https://bsky.app/profile/${encodeURIComponent(actual.platformAccountId)}`,
      forem: `https://dev.to/${handle}`,
    };
    const account: Account = {
      id: actual.id,
      platformAccountId: actual.platformAccountId,
      username: old?.username ?? username,
      apiUsername: actual.username,
      resources: { ...old?.resources },
      capabilities: [...(old?.capabilities ?? [])],
      ...old,
      observer: old?.observer ?? { profileUrl: profiles[platform], fields: {}, open: [] },
    };
    // Refresh API identity, while preserving calibrated observer identity and selectors.
    account.apiUsername = actual.username;
    account.platformAccountId = actual.platformAccountId;
    if (platform === "telegram" && /^[1-9]\d*$/.test(actual.platformAccountId))
      notes.push(
        "telegram: this is a private chat, not a public channel. Verification requires a Telegram Web login and calibrated message selectors; the user's t.me profile cannot show these posts.",
      );
    if (actual.credentialStatus?.action === "reconnect")
      notes.push(`${platform}: reconnect this account before posting.`);
    if (platform === "tiktok") {
      try {
        const { creatorInfo } = await read<{
          creatorInfo: {
            creatorUsername: string | null;
            privacyLevelOptions: string[];
            commentDisabled: boolean;
            duetDisabled: boolean;
            stitchDisabled: boolean;
            canPost: boolean;
            blockReason: string | null;
          };
        }>(`/api/v1/accounts/${id}/tiktok/creator-info`);
        const dynamic = (tag: string) =>
          tag.startsWith("privacy:") || ["allowComment", "allowDuet", "allowStitch"].includes(tag);
        account.capabilities = account.capabilities.filter((tag) => !dynamic(tag));
        account.capabilities.push(...creatorInfo.privacyLevelOptions.map((p) => `privacy:${p}`));
        if (!creatorInfo.privacyLevelOptions.includes(String(account.resources.defaultPrivacyLevel ?? ""))) {
          const audience = creatorInfo.privacyLevelOptions.includes("PUBLIC_TO_EVERYONE")
            ? "PUBLIC_TO_EVERYONE"
            : creatorInfo.privacyLevelOptions[0];
          if (audience) account.resources.defaultPrivacyLevel = audience;
        }
        for (const [key, disabled] of [
          ["allowComment", creatorInfo.commentDisabled],
          ["allowDuet", creatorInfo.duetDisabled],
          ["allowStitch", creatorInfo.stitchDisabled],
        ] as const)
          if (!disabled) account.capabilities.push(key);
        if (creatorInfo.creatorUsername) {
          account.username = creatorInfo.creatorUsername;
          account.observer.profileUrl = `https://www.tiktok.com/@${encodeURIComponent(creatorInfo.creatorUsername.replace(/^@/, ""))}`;
        }
        if (!creatorInfo.canPost)
          notes.push(`tiktok: ${creatorInfo.blockReason ?? "platform currently blocks posting"}`);
      } catch {
        notes.push("tiktok: creator capabilities could not be read; reconnect/check access and rerun setup.");
      }
    }
    if (platform === "pinterest") {
      try {
        const { boards } = await read<{ boards: { id: string; name: string }[] }>(`/api/v1/accounts/${id}/boards`);
        const selectedBoard =
          boards.find((b) => b.id === account.resources.boardId)?.id ??
          (boards.length === 1
            ? boards[0].id
            : boards.length
              ? await choose(
                  "Choose the Pinterest test board",
                  boards.map((b) => ({ id: b.id, label: b.name })),
                )
              : undefined);
        const board = boards.find((b) => b.id === selectedBoard);
        if (board) {
          account.resources.boardId = board.id;
          account.resources.boardName = board.name;
        } else notes.push("pinterest: no board selected; create/select a test board before posting.");
      } catch {
        notes.push("pinterest: boards could not be selected; rerun setup interactively or set boardId/boardName.");
      }
    }
    if (platform === "youtube") {
      try {
        const library = await read<{
          channels?: { id: string; title: string }[];
          playlists?: { id: string; title: string }[];
        }>(`/api/v1/accounts/${encodeURIComponent(id)}/youtube/library`);
        const channels = library.channels ?? [];
        const channelId =
          channels.find((channel) => channel.id === account.resources.channelId)?.id ??
          (channels.length === 1
            ? channels[0].id
            : channels.length
              ? await choose(
                  "Choose the YouTube test channel",
                  channels.map((channel) => ({ id: channel.id, label: channel.title || channel.id })),
                )
              : undefined);
        const channel = channels.find((candidate) => candidate.id === channelId);
        if (channel) {
          account.resources.channelId = channel.id;
          account.resources.channelTitle = channel.title;
          if (!old?.observer.profileUrl || new URL(old.observer.profileUrl).pathname === "/")
            account.observer.profileUrl = `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`;
        } else notes.push("youtube: no channel was returned by the owner readback endpoint.");

        const playlists = library.playlists ?? [];
        const playlistId =
          playlists.find((playlist) => playlist.id === account.resources.playlistId)?.id ??
          (playlists.length === 1
            ? playlists[0].id
            : playlists.length > 1
              ? await choose(
                  "Choose the YouTube test playlist",
                  playlists.map((playlist) => ({ id: playlist.id, label: playlist.title || playlist.id })),
                )
              : undefined);
        const playlist = playlists.find((candidate) => candidate.id === playlistId);
        if (playlist) {
          account.resources.playlistId = playlist.id;
          account.resources.playlistTitle = playlist.title;
        } else if (!playlists.length)
          notes.push("youtube: no playlist was returned; playlist scenario will remain blocked.");
        account.observer.youtubeReadback = true;
      } catch {
        notes.push(
          "youtube: owner readback is unavailable; deploy the account library endpoint or configure youtubeAccessTokenEnv.",
        );
      }
    }
    if (!old && ["youtube", "linkedin", "forem", "telegram"].includes(platform))
      notes.push(
        `${platform}: verify the social profile URL; this API does not expose all public profile identifiers.`,
      );
    accounts[platform] = account;
  }
  return { userId: owners[0], accounts, selected, notes };
}
