import { useState } from "react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { maxFileSize, platforms, type Variant } from "@/lib/workspaces/contracts";

import { localTime, platformName, request, type FileInfo, type Item, type Run, type Workspace } from "./types";

const freshVariant = (platform: Variant["platform"]): Variant => ({
  platform,
  caption: "",
  accountId: null,
  destination: null,
  fileIds: [],
  options: {},
});
export function PostEditor({
  workspace: w,
  post,
  run,
  close,
  plannedDay,
}: {
  workspace: Workspace;
  post?: Item;
  run: Run;
  close: () => void;
  plannedDay?: Date;
}) {
  const [baseRevision] = useState(post?.revision);
  const [variants, setVariants] = useState<Variant[]>(post?.variants ?? [freshVariant("instagram")]);
  const [files, setFiles] = useState(w.files);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  function patch(platform: string, change: Partial<Variant>) {
    setVariants((list) => list.map((v) => (v.platform === platform ? { ...v, ...change } : v)));
  }
  async function upload(v: Variant, file: File) {
    setError("");
    setUploading(true);
    try {
      if (file.size > maxFileSize) throw new Error("Choose a file of 8 MiB or smaller");
      const info = await request<FileInfo>(`/api/v1/workspaces/${w.id}/files?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
      });
      setFiles((list) => [...list, info]);
      patch(v.platform, { fileIds: [...v.fileIds, info.id] });
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form
      className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const value = (k: string) => String(data.get(k) ?? "");
        const fields = {
          title: post?.deliveredAt ? post.title : value("title"),
          plannedAt:
            post && (post.deliveredAt || value("planned") === localTime(post.plannedAt))
              ? post.plannedAt
              : new Date(value("planned")).toISOString(),
          dueAt: value("due") ? new Date(value("due")).toISOString() : null,
          ownerId: value("owner") || null,
          variants,
        };
        if (
          await run(
            post
              ? { action: "edit", postId: post.id, revision: baseRevision!, ...fields }
              : { action: "createPost", ...fields },
          )
        )
          close();
      }}>
      <h2 className="text-lg font-semibold tracking-tight">{post ? "Edit post" : "New post"}</h2>
      <Label className="min-w-0 flex-col items-stretch">
        Post title
        <Input name="title" required maxLength={80} defaultValue={post?.title} disabled={!!post?.deliveredAt} />
      </Label>
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        <Label className="min-w-0 flex-col items-stretch">
          Planned publication
          <Input
            type="datetime-local"
            name="planned"
            required
            disabled={!!post?.deliveredAt}
            defaultValue={localTime(
              post?.plannedAt ?? plannedDay?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(),
            )}
          />
        </Label>
        <Label className="min-w-0 flex-col items-stretch">
          Owner
          <NativeSelect name="owner" defaultValue={post ? (post.ownerId ?? "") : w.member.userId}>
            <option value="">Unassigned</option>
            {w.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="min-w-0 flex-col items-stretch">
          Internal deadline
          <Input type="datetime-local" name="due" defaultValue={post?.dueAt ? localTime(post.dueAt) : ""} />
        </Label>
      </div>
      <fieldset className="min-w-0 space-y-4" disabled={!!post?.deliveredAt || uploading}>
        <legend className="mb-3 text-sm font-semibold">Platform variants</legend>
        <div className="flex flex-wrap items-end gap-3">
          {platforms.map((platform) => (
            <Label key={platform} className="shrink-0">
              <input
                className="size-4 accent-primary"
                type="checkbox"
                checked={variants.some((v) => v.platform === platform)}
                onChange={(e) =>
                  setVariants(
                    e.target.checked
                      ? [...variants, freshVariant(platform)]
                      : variants.filter((v) => v.platform !== platform),
                  )
                }
              />
              <PlatformIconBadge platform={platform} />
              {platformName[platform]}
            </Label>
          ))}
        </div>
        {variants.map((v) => (
          <div key={v.platform} className="min-w-0 space-y-4 rounded-xl border border-border bg-background/40 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <PlatformIconBadge platform={v.platform} /> {platformName[v.platform]}
            </h3>
            <Label className="min-w-0 flex-col items-stretch">
              Caption
              <Textarea
                maxLength={12_000}
                value={v.caption}
                onChange={(e) => patch(v.platform, { caption: e.target.value })}
              />
            </Label>
            {w.member.userId === w.creatorId ? (
              <Label className="min-w-0 flex-col items-stretch">
                Destination
                <NativeSelect
                  value={v.accountId ?? ""}
                  onChange={(e) => patch(v.platform, { accountId: e.target.value || null, destination: null })}>
                  <option value="">Native publishing</option>
                  {w.accounts
                    .filter((a) => a.platform === v.platform)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName || a.username || a.id}
                      </option>
                    ))}
                </NativeSelect>
              </Label>
            ) : (
              <small className="block text-xs text-muted-foreground">
                {v.destination?.label ?? "Native publishing"}
              </small>
            )}
            {v.platform === "tiktok" && (
              <Label className="min-w-0 flex-col items-stretch">
                TikTok audience
                <NativeSelect
                  value={v.options.privacyLevel ?? ""}
                  onChange={(e) =>
                    patch(v.platform, {
                      options: e.target.value
                        ? { privacyLevel: e.target.value as Variant["options"]["privacyLevel"] }
                        : {},
                    })
                  }>
                  <option value="">Choose audience</option>
                  {["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </NativeSelect>
              </Label>
            )}
            {v.platform === "linkedin" && (
              <Label className="min-w-0 flex-col items-stretch">
                LinkedIn visibility
                <NativeSelect
                  value={v.options.visibility ?? ""}
                  onChange={(e) =>
                    patch(v.platform, {
                      options: e.target.value ? { visibility: e.target.value as "PUBLIC" | "CONNECTIONS" } : {},
                    })
                  }>
                  <option value="">Platform default</option>
                  <option value="PUBLIC">Public</option>
                  <option value="CONNECTIONS">Connections</option>
                </NativeSelect>
              </Label>
            )}
            <h4 className="text-sm font-medium">Final media</h4>
            {v.fileIds.map((id, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <span>
                  {i + 1}. {files.find((f) => f.id === id)?.filename}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={!i}
                  onClick={() => {
                    const ids = [...v.fileIds];
                    [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                    patch(v.platform, { fileIds: ids });
                  }}>
                  Move up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => patch(v.platform, { fileIds: v.fileIds.filter((_, index) => index !== i) })}>
                  Remove
                </Button>
              </div>
            ))}
            {v.fileIds.length < 10 && (
              <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
                <Label className="min-w-0 flex-col items-stretch">
                  Upload file · up to 8 MiB
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,video/mp4"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(v, f);
                      e.target.value = "";
                    }}
                  />
                </Label>
                {files.length > 0 && (
                  <Label className="min-w-0 flex-col items-stretch">
                    Use workspace file
                    <NativeSelect
                      value=""
                      onChange={(e) => patch(v.platform, { fileIds: [...v.fileIds, e.target.value] })}>
                      <option value="">Select file</option>
                      {files
                        .filter((f) => !v.fileIds.includes(f.id))
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.filename}
                          </option>
                        ))}
                    </NativeSelect>
                  </Label>
                )}
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Button size="sm" disabled={variants.length === 0 || uploading}>
          {uploading ? "Uploading…" : "Save post"}
        </Button>
        <Button variant="outline" size="sm" type="button" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
