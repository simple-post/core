import { PlatformPostPreview } from "@/features/platform-preview/platform-post-preview";
import type { Variant } from "@/lib/workspaces/contracts";
import type { MediaFile } from "@/types";

import type { FileInfo, Workspace } from "./types";

export function workspaceMedia(workspaceId: string, file: FileInfo, size = 0): MediaFile {
  return {
    id: file.id,
    filename: file.filename,
    contentType: file.mime,
    type: file.mime.startsWith("video/") ? "video" : "image",
    url: `/api/v1/workspaces/${workspaceId}/files/${file.id}`,
    size,
  };
}
export function variantMedia(id: string, files: FileInfo[], variant?: Variant) {
  return (variant?.fileIds ?? []).flatMap((key) => {
    const file = files.find((f) => f.id === key);
    return file ? [workspaceMedia(id, file)] : [];
  });
}
export function WorkspacePreview({
  workspace,
  variants,
  activePlatform,
  onPlatformChange,
  files = workspace.files,
  date,
}: {
  workspace: Workspace;
  variants: Variant[];
  activePlatform?: Variant["platform"];
  onPlatformChange?: (platform: Variant["platform"]) => void;
  files?: FileInfo[];
  date?: Date;
}) {
  const accounts = variants.map((v) => {
    const account = workspace.accounts.find((a) => a.id === v.accountId);
    return {
      id: v.platform,
      platform: v.platform,
      username: account?.username ?? null,
      displayName: v.destination?.label ?? account?.displayName ?? workspace.name,
      email: null,
      profilePicture: null,
      platformAccountId: v.destination?.platformAccountId ?? v.platform,
    };
  });
  return (
    <PlatformPostPreview
      activePlatform={activePlatform}
      onPlatformChange={(platform) => {
        const variant = variants.find((v) => v.platform === platform);
        if (variant) onPlatformChange?.(variant.platform);
      }}
      message=""
      media={[]}
      selectedAccounts={accounts}
      accountOptions={Object.fromEntries(variants.map((v) => [v.platform, v.options]))}
      accountOverrides={Object.fromEntries(
        variants.map((v) => [v.platform, { message: v.caption, media: variantMedia(workspace.id, files, v) }]),
      )}
      previewDate={date}
    />
  );
}
