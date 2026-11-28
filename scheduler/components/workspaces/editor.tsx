import { useRef, useState } from "react";

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
import {
  localTime,
  platformName,
  request,
  workspaceAccountForVariant,
  type FileInfo,
  type Item,
  type Run,
  type Workspace,
} from "./types";

function freshVariant(platform: Variant["platform"], accounts: Workspace["accounts"]): Variant {
  const matches = accounts.filter((account) => account.platform === platform);
  return {
    platform,
    caption: "",
    accountId: matches.length === 1 ? matches[0].id : null,
    destination: null,
    fileIds: [],
    options: {},
  };
}
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
  const connectedPlatforms = platforms.filter((platform) =>
    w.accounts.some((account) => account.platform === platform),
  );
  const [variants, setVariants] = useState<Variant[]>(
    () => post?.variants ?? [freshVariant(connectedPlatforms[0] ?? "instagram", w.accounts)],
  );
  const deselectedVariants = useRef<Partial<Record<Variant["platform"], Variant>>>({});
  const [files, setFiles] = useState(w.files);
  const [uploading, setUploading] = useState(false);
  const [activePlatform, setActivePlatform] = useState(variants[0]?.platform);
  const active = variants.find((v) => v.platform === activePlatform) ?? variants[0];
  const ownsConnections = w.member.userId === w.creatorId;
  const accounts = w.accounts.filter((account) => account.platform === active?.platform);
  const selectedAccount = active ? workspaceAccountForVariant(accounts, active) : undefined;
  const availableFiles = files.filter((file) => !active?.fileIds.includes(file.id));
  const draftChoices = platforms.filter(
    (platform) =>
      connectedPlatforms.length === 0 ||
      variants.some((v) => v.platform === platform && !workspaceAccountForVariant(w.accounts, v)),
  );
  const destinations = [
    ...w.accounts.flatMap((account) => {
      const platform = platforms.find((value) => value === account.platform);
      if (!platform) return [];
      const label = account.displayName || account.username || platformName[platform];
      const pickerLabel = account.displayName && account.username ? `${label} · ${account.username}` : label;
      return [
        {
          id: account.id,
          platform,
          label: pickerLabel,
          accessibleLabel: `${platformName[platform]} · ${pickerLabel}`,
          accountId: account.id,
          destination: { label, platformAccountId: account.platformAccountId },
        },
      ];
    }),
    ...draftChoices.map((platform) => ({
      id: `draft:${platform}`,
      platform,
      label: connectedPlatforms.length > 0 ? `${platformName[platform]} · Account needed` : platformName[platform],
      accessibleLabel: `${platformName[platform]} draft`,
      accountId: null,
      destination: null,
    })),
  ];
  const selectedDestinations = variants.map(
    (variant) => workspaceAccountForVariant(w.accounts, variant)?.id ?? `draft:${variant.platform}`,
  );
  const currentReview = post?.reviews.find((review) => review.id === post.currentReviewId);
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
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">
              {connectedPlatforms.length > 0 ? "Workspace accounts" : "Draft channels"}
            </h2>
            {w.accounts.length > connectedPlatforms.length && (
              <p className="text-xs text-muted-foreground">Choose one account per platform.</p>
            )}
            <AccountRowPicker
              compact
              title={connectedPlatforms.length > 0 ? "Workspace accounts" : "Draft channels"}
              selectedIds={selectedDestinations}
              items={destinations.map((destination) => ({
                ...destination,
                avatar: <PlatformIconBadge platform={destination.platform} />,
              }))}
              onToggle={(id) => {
                const destination = destinations.find((entry) => entry.id === id);
                if (!destination) return;
                const { platform, accountId, destination: identity } = destination;
                const previous = variants.find((variant) => variant.platform === platform);
                if (selectedDestinations.includes(id)) {
                  if (previous) deselectedVariants.current[platform] = previous;
                  setVariants((list) => list.filter((v) => v.platform !== platform));
                  return;
                }
                if (previous) patch(platform, { accountId, destination: identity });
                else {
                  const draft = deselectedVariants.current[platform] ?? {
                    ...freshVariant(platform, w.accounts),
                    caption: active?.caption ?? "",
                    fileIds: active?.fileIds ?? [],
                  };
                  setVariants((list) => [...list, { ...draft, accountId, destination: identity }]);
                }
                setActivePlatform(platform);
              }}
            />
          </div>
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
              {!selectedAccount && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3.5 py-3">
                  <p className="text-sm text-muted-foreground">
                    {accounts.length > 0
                      ? `Select a workspace account for ${platformName[active.platform]} above.`
                      : ownsConnections
                        ? `Connect a ${platformName[active.platform]} account to publish from this workspace.`
                        : `Ask the workspace owner to connect a ${platformName[active.platform]} account before publishing.`}
                  </p>
                  {accounts.length === 0 && ownsConnections && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={workspaceHref("/accounts", w.id)}>Open Accounts</Link>
                    </Button>
                  )}
                </div>
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
              {active.fileIds.length < 10 && availableFiles.length > 0 && (
                <Label className="min-w-0 flex-col items-stretch">
                  Attach an existing file
                  <NativeSelect
                    value=""
                    onChange={(e) => patch(active.platform, { fileIds: [...active.fileIds, e.target.value] })}>
                    <option value="" disabled>
                      Select file
                    </option>
                    {availableFiles.map((f) => (
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
        <fieldset disabled={!!post?.deliveredAt} className="space-y-2">
          <legend className="text-sm font-medium">Planned publication</legend>
          {post && initialPlan.slice(0, 10) < localTime(new Date().toISOString()).slice(0, 10) ? (
            <Label>
              <Input
                aria-label="Planned publication date and time"
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
              hideLabel
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
        {currentReview && (!currentReview.outcome || currentReview.outcome === "approved") && !post?.deliveredAt && (
          <p className="text-sm text-muted-foreground">
            Changing the content, destination, or planned time requires a new review.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Button size="sm" disabled={variants.length === 0 || uploading || !validDate}>
            {uploading ? "Uploading…" : post ? "Save changes" : "Save draft"}
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
