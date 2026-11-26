import { useState } from "react";

import Link from "next/link";

import { AccountRowPicker } from "@/components/account-row-picker";
import { ComposerColumns } from "@/components/composer-columns";
import { PlatformIconBadge } from "@/components/platform-icons";
import { PostContentEditor } from "@/components/post-content-editor";
import { ScheduleDateTimePicker } from "@/components/schedule-date-time-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { maxFileSize, platforms, type Variant } from "@/lib/workspaces/contracts";

import { WorkspacePreview, variantMedia, workspaceMedia } from "./preview";
import { workspaceHref } from "./switcher";
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
  const [activePlatform, setActivePlatform] = useState(variants[0]?.platform);
  const active = variants.find((v) => v.platform === activePlatform) ?? variants[0];
  const missingConnection = Boolean(
    active?.accountId && !w.accounts.some((account) => account.id === active.accountId),
  );
  const [initialPlan] = useState(() => {
    if (post) return localTime(post.plannedAt);
    const next = new Date(Date.now() + 3_600_000);
    const day = new Date(plannedDay ?? Date.now() + 86_400_000);
    day.setHours(next.getHours(), next.getMinutes(), 0, 0);
    if (plannedDay && day < new Date() && day.toDateString() === new Date().toDateString())
      return localTime(next.toISOString());
    return localTime(day.toISOString());
  });
  const [date, setDate] = useState(initialPlan.split("T")[0]);
  const [time, setTime] = useState(initialPlan.split("T")[1]);
  const planned = date + "T" + time;
  const validDate = Number.isFinite(Date.parse(planned)) ? new Date(planned) : undefined;
  function patch(platform: string, change: Partial<Variant>) {
    setVariants((list) => list.map((v) => (v.platform === platform ? { ...v, ...change } : v)));
  }
  async function storeFile(file: File) {
    const info = await request<FileInfo>(`/api/v1/workspaces/${w.id}/files?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: file,
    });
    setFiles((list) => [...list, info]);
    return workspaceMedia(w.id, info, file.size);
  }
  return (
    <ComposerColumns>
      <form
        className="space-y-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!validDate) return;
          const data = new FormData(e.currentTarget);
          const value = (k: string) => String(data.get(k) ?? "");
          const fields = {
            title: post?.deliveredAt
              ? post.title
              : value("title").trim() ||
                variants
                  .find((v) => v.caption.trim())
                  ?.caption.trim()
                  .slice(0, 80) ||
                "Untitled post",
            plannedAt: post && (post.deliveredAt || planned === initialPlan) ? post.plannedAt : validDate.toISOString(),
            dueAt: value("due") ? new Date(value("due")).toISOString() : null,
            ownerId: value("owner") || null,
            variants,
          };
          const saved = await run(
            post
              ? { action: "edit", postId: post.id, revision: baseRevision!, ...fields }
              : { action: "createPost", ...fields },
          );
          if (saved && post) close();
        }}>
        <fieldset disabled={!!post?.deliveredAt || uploading} className="min-w-0 space-y-4">
          <AccountRowPicker
            description="Choose where to publish this post."
            selectedIds={variants.map((v) => v.platform)}
            items={platforms.map((platform) => ({
              id: platform,
              platform,
              label: platformName[platform],
              accessibleLabel: platformName[platform],
              avatar: <PlatformIconBadge platform={platform} />,
            }))}
            onToggle={(id) => {
              const platform = platforms.find((p) => p === id);
              if (!platform) return;
              if (variants.some((v) => v.platform === platform))
                setVariants((list) => list.filter((v) => v.platform !== platform));
              else {
                setVariants((list) => [
                  ...list,
                  { ...freshVariant(platform), caption: active?.caption ?? "", fileIds: active?.fileIds ?? [] },
                ]);
                setActivePlatform(platform);
              }
            }}
          />
          {active && (
            <div className="space-y-4">
              {variants.length > 1 && (
                <Label>
                  Editing
                  <NativeSelect
                    value={active.platform}
                    onChange={(e) => setActivePlatform(e.target.value as Variant["platform"])}>
                    {variants.map((v) => (
                      <option key={v.platform} value={v.platform}>
                        {platformName[v.platform]}
                      </option>
                    ))}
                  </NativeSelect>
                  {missingConnection && (
                    <span className="text-sm text-muted-foreground">
                      Choose another destination or{" "}
                      <Link className="text-primary underline" href={workspaceHref("/accounts", w.id)}>
                        connect an account
                      </Link>{" "}
                      to this workspace.
                    </span>
                  )}
                </Label>
              )}
              <PostContentEditor
                key={active.platform}
                id="message"
                message={active.caption}
                onMessageChange={(caption) => patch(active.platform, { caption })}
                maxTextLength={12_000}
                media={variantMedia(w.id, files, active)}
                onMediaChange={(media) => patch(active.platform, { fileIds: media.map((f) => f.id) })}
                uploadProps={{
                  storeFile,
                  maxFileSize,
                  maxFiles: 10,
                  acceptedTypes: ["image/png", "image/jpeg", "image/webp", "video/mp4"],
                  onUploadingChange: setUploading,
                }}
              />
              {w.member.userId === w.creatorId ? (
                <Label className="min-w-0 flex-col items-stretch">
                  Destination
                  <NativeSelect
                    value={active.accountId ?? ""}
                    onChange={(e) => patch(active.platform, { accountId: e.target.value || null, destination: null })}>
                    <option value="">Native publishing</option>
                    {missingConnection && (
                      <option value={active.accountId!} disabled>
                        Connection unavailable
                      </option>
                    )}
                    {w.accounts
                      .filter((a) => a.platform === active.platform)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.displayName || a.username || a.id}
                        </option>
                      ))}
                  </NativeSelect>
                </Label>
              ) : (
                <small className="block text-xs text-muted-foreground">
                  {active.destination?.label ?? "Native publishing"}
                </small>
              )}
              {active.platform === "tiktok" && (
                <Label className="min-w-0 flex-col items-stretch">
                  TikTok audience
                  <NativeSelect
                    value={active.options.privacyLevel ?? ""}
                    onChange={(e) =>
                      patch(active.platform, {
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
              {active.platform === "linkedin" && (
                <Label className="min-w-0 flex-col items-stretch">
                  LinkedIn visibility
                  <NativeSelect
                    value={active.options.visibility ?? ""}
                    onChange={(e) =>
                      patch(active.platform, {
                        options: e.target.value ? { visibility: e.target.value as "PUBLIC" | "CONNECTIONS" } : {},
                      })
                    }>
                    <option value="">Platform default</option>
                    <option value="PUBLIC">Public</option>
                    <option value="CONNECTIONS">Connections</option>
                  </NativeSelect>
                </Label>
              )}
              {active.fileIds.length > 1 && (
                <Label>
                  Media order
                  <NativeSelect
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      const ids = active.fileIds.filter((key) => key !== id);
                      patch(active.platform, { fileIds: [id, ...ids] });
                    }}>
                    <option value="">Move file to first position</option>
                    {active.fileIds.slice(1).map((id) => (
                      <option key={id} value={id}>
                        {files.find((f) => f.id === id)?.filename}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
              )}
              {active.fileIds.length < 10 && files.length > 0 && (
                <Label className="min-w-0 flex-col items-stretch">
                  Use workspace file
                  <NativeSelect
                    value=""
                    onChange={(e) => patch(active.platform, { fileIds: [...active.fileIds, e.target.value] })}>
                    <option value="">Select file</option>
                    {files
                      .filter((f) => !active.fileIds.includes(f.id))
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
        </fieldset>
        <fieldset disabled={!!post?.deliveredAt}>
          {post && initialPlan.slice(0, 10) < localTime(new Date().toISOString()).slice(0, 10) ? (
            <Label>
              Planned publication
              <Input
                type="datetime-local"
                required
                value={planned}
                onChange={(e) => {
                  const [d, t] = e.target.value.split("T");
                  setDate(d);
                  setTime(t);
                }}
              />
            </Label>
          ) : (
            <ScheduleDateTimePicker
              scheduledDate={date}
              scheduledTime={time}
              onScheduledDateChange={setDate}
              onScheduledTimeChange={setTime}
            />
          )}
        </fieldset>
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Team planning</h2>
          <Label className="min-w-0 flex-col items-stretch">
            Post title (optional)
            <Input name="title" maxLength={80} defaultValue={post?.title} disabled={!!post?.deliveredAt} />
          </Label>
          <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
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
        </section>
        <div className="flex flex-wrap items-end gap-3">
          <Button size="sm" disabled={variants.length === 0 || uploading || !validDate}>
            {uploading ? "Uploading…" : "Save post"}
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
      <div className="lg:sticky lg:top-24 self-start">
        <WorkspacePreview
          activePlatform={active?.platform}
          onPlatformChange={(platform) => {
            if (!uploading) setActivePlatform(platform);
          }}
          workspace={w}
          variants={variants}
          files={files}
          date={validDate}
        />
      </div>
    </ComposerColumns>
  );
}
