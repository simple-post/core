import { useState } from "react";

import { PlatformIcon } from "@/components/platform-icon";
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
}: {
  workspace: Workspace;
  post?: Item;
  run: Run;
  close: () => void;
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
      className="tw-editor"
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
      <h2>{post ? "Edit post" : "New post"}</h2>
      <label>
        Post title
        <input name="title" required maxLength={80} defaultValue={post?.title} disabled={!!post?.deliveredAt} />
      </label>
      <div className="tw-fields">
        <label>
          Planned publication
          <input
            type="datetime-local"
            name="planned"
            required
            disabled={!!post?.deliveredAt}
            defaultValue={localTime(post?.plannedAt ?? new Date(Date.now() + 86_400_000).toISOString())}
          />
        </label>
        <label>
          Owner
          <select name="owner" defaultValue={post ? (post.ownerId ?? "") : w.member.userId}>
            <option value="">Unassigned</option>
            {w.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Internal deadline
          <input type="datetime-local" name="due" defaultValue={post?.dueAt ? localTime(post.dueAt) : ""} />
        </label>
      </div>
      <fieldset disabled={!!post?.deliveredAt || uploading}>
        <legend>Platform variants</legend>
        <div className="tw-line">
          {platforms.map((platform) => (
            <label key={platform} className="tw-check">
              <input
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
              <PlatformIcon platform={platform} />
              {platformName[platform]}
            </label>
          ))}
        </div>
        {variants.map((v) => (
          <div key={v.platform} className="tw-variant">
            <h3>
              <PlatformIcon platform={v.platform} /> {platformName[v.platform]}
            </h3>
            <label>
              Caption
              <textarea
                maxLength={12_000}
                value={v.caption}
                onChange={(e) => patch(v.platform, { caption: e.target.value })}
              />
            </label>
            {w.member.userId === w.creatorId ? (
              <label>
                Destination
                <select
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
                </select>
              </label>
            ) : (
              <small>{v.destination?.label ?? "Native publishing"}</small>
            )}
            {v.platform === "tiktok" && (
              <label>
                TikTok audience
                <select
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
                </select>
              </label>
            )}
            {v.platform === "linkedin" && (
              <label>
                LinkedIn visibility
                <select
                  value={v.options.visibility ?? ""}
                  onChange={(e) =>
                    patch(v.platform, {
                      options: e.target.value ? { visibility: e.target.value as "PUBLIC" | "CONNECTIONS" } : {},
                    })
                  }>
                  <option value="">Platform default</option>
                  <option value="PUBLIC">Public</option>
                  <option value="CONNECTIONS">Connections</option>
                </select>
              </label>
            )}
            <h4>Final media</h4>
            {v.fileIds.map((id, i) => (
              <div key={i} className="tw-line">
                <span>
                  {i + 1}. {files.find((f) => f.id === id)?.filename}
                </span>
                <button
                  type="button"
                  disabled={!i}
                  onClick={() => {
                    const ids = [...v.fileIds];
                    [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                    patch(v.platform, { fileIds: ids });
                  }}>
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => patch(v.platform, { fileIds: v.fileIds.filter((_, index) => index !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            {v.fileIds.length < 10 && (
              <div className="tw-fields">
                <label>
                  Upload file · up to 8 MiB
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,video/mp4"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(v, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {files.length > 0 && (
                  <label>
                    Use workspace file
                    <select value="" onChange={(e) => patch(v.platform, { fileIds: [...v.fileIds, e.target.value] })}>
                      <option value="">Select file</option>
                      {files
                        .filter((f) => !v.fileIds.includes(f.id))
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.filename}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="tw-line">
        <button className="primary" disabled={variants.length === 0 || uploading}>
          {uploading ? "Uploading…" : "Save post"}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
