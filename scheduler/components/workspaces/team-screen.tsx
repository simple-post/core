"use client";
import { useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { BackLink } from "@/components/back-link";
import { DashboardStatusTabs, TabCountBadge } from "@/components/dashboard-status-tabs";
import { Navbar } from "@/components/navbar";
import { PostsDashboard } from "@/components/posts-dashboard";
import { PostListFooter } from "@/components/posts-list";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PostCardView } from "@/components/visual/post-card";
import { useSession } from "@/lib/auth/auth-client";

import { PlannerCalendar } from "./calendar";
import { PostDetail } from "./detail";
import { PostEditor } from "./editor";
import { variantMedia } from "./preview";
import { TeamSettings } from "./settings";
import { WorkspaceSettingsLayout } from "./settings-layout";
import { workspaceHref, useWorkspaceIndex } from "./switcher";
import {
  deliveryStatus,
  displayDate,
  json,
  request,
  workspacePostStatus,
  type Item,
  type Run,
  type Workspace,
} from "./types";

export function TeamScreen({
  id,
  postId,
  view,
  embedded = false,
}: {
  id: string;
  postId?: string;
  view: "dashboard" | "compose" | "edit" | "detail" | "settings";
  embedded?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const { current, refresh, pending, indexError } = useWorkspaceIndex();
  const path = "/api/v1/workspaces/" + encodeURIComponent(id);
  const query = useQuery({
    queryKey: ["team-workspace", session?.user.id, id],
    enabled: !!current,
    staleTime: 0,
    queryFn: () => request<Workspace>(path),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const href = (route: string) => workspaceHref(route, id);
  const postHref = (key: string) => href("/posts/" + encodeURIComponent(key));
  const run: Run = async (cmd) => {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string | null; invitationEmailSent?: boolean }>(path, json(cmd));
      if (cmd.action === "remove" && cmd.userId === session?.user.id) {
        await refresh();
        router.replace("/");
        return true;
      }
      await query.refetch({ throwOnError: true });
      if (cmd.action === "settings" || cmd.action === "remove" || cmd.action === "member") await refresh();
      if (cmd.action === "invite" || cmd.action === "resendInvite") {
        if (result.invitationEmailSent) toast.success("Invitation email sent");
        else toast.error("Invitation saved. The email could not be sent. Try again from Members.");
      }
      if (cmd.action === "createPost" && result.id) router.push(postHref(result.id));
      return true;
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not save changes");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const w = current ? query.data : undefined;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const message = error || indexError?.message || query.error?.message;
  const notice = message && (
    <p role="alert" className="mb-4 text-sm text-destructive">
      {message}{" "}
      <button
        className="underline"
        onClick={() => {
          void (indexError ? refresh() : query.refetch()).then(() => {
            setError("");
            setReload((n) => n + 1);
          });
        }}>
        Reload workspace
      </button>
    </p>
  );
  const item = w?.posts.find((p) => p.id === postId);
  const canEdit = w?.member.role !== "Viewer";
  if (view === "dashboard" && !w)
    return (
      <PostsDashboard
        calendar={
          notice || <p role="status">{pending || current ? "Loading workspace…" : "Workspace unavailable."}</p>
        }>
        {null}
      </PostsDashboard>
    );
  if (view === "dashboard" && w) {
    const statusTab = { draft: "drafts", scheduled: "scheduled", published: "past", failed: "failed" } as const;
    const counts = { drafts: 0, approvals: 0, scheduled: 0, past: 0, failed: 0 };
    const reviewState = w.states.find((s) => s.kind === "review");
    const postTab = (post: Item) => (post.stateId === reviewState?.id ? "approvals" : statusTab[deliveryStatus(post)]);
    for (const post of w.posts) counts[postTab(post)]++;
    const requested = params.get("tab") ?? "drafts";
    const tab = Object.hasOwn(counts, requested) ? requested : "drafts";
    const posts = w.posts.filter((post) => postTab(post) === tab);
    const totalPages = Math.ceil(posts.length / pageSize);
    const currentPage = Math.max(1, Math.min(totalPages, page));
    return (
      <PostsDashboard
        calendar={
          <PlannerCalendar
            workspace={w}
            open={(key) => router.push(postHref(key))}
            create={
              canEdit ? (day) => router.push(href("/schedule?day=" + encodeURIComponent(day.toISOString()))) : undefined
            }
          />
        }>
        {notice}
        <Tabs
          value={tab}
          onValueChange={(t) => {
            setPage(1);
            router.replace(href("/?tab=" + t), { scroll: false });
          }}>
          <DashboardStatusTabs
            counts={counts}
            extra={[
              {
                id: "approvals",
                label: "Approvals",
                icon: <ClipboardCheck className="hidden h-3.5 w-3.5 sm:block" />,
                badge: <TabCountBadge count={counts.approvals} className="ml-0 sm:ml-1" />,
              },
            ]}
          />
          <TabsContent value={tab} className="mt-0 space-y-3">
            {posts.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((p) => (
              <Link
                key={p.id}
                className="block"
                href={tab === "approvals" ? href("/posts/" + p.id + "?review=1") : postHref(p.id)}>
                <PostCardView
                  post={{
                    message: p.variants[0]?.caption || p.title,
                    status: deliveryStatus(p),
                    media: variantMedia(id, w.files, p.variants[0]),
                  }}
                  draftLabel={workspacePostStatus(w, p, p).label}
                  platforms={p.variants.map((v) => v.platform)}
                  dateLabel={displayDate(p.plannedAt)}
                  accountLabels={p.variants.map((v) => v.destination?.label).filter((name): name is string => !!name)}
                />
              </Link>
            ))}
            {posts.length > 0 && (
              <PostListFooter
                pagination={{
                  totalPages,
                  total: posts.length,
                  limit: pageSize,
                  page: currentPage,
                  hasNextPage: currentPage < totalPages,
                  hasPreviousPage: currentPage > 1,
                }}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            )}
            {posts.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {tab === "approvals" ? "No posts awaiting approval." : "No posts in this view."}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </PostsDashboard>
    );
  }
  if (view === "settings") {
    const sections = [
      { id: "general", label: "General" },
      { id: "members", label: "Members" },
      { id: "workflow", label: "Approval workflow" },
      ...(w?.files.length ? [{ id: "files", label: "Files" }] : []),
    ];
    return (
      <WorkspaceSettingsLayout id={id} name={w?.name} color={w?.color} sections={w ? sections : []}>
        {notice}
        {w ? (
          <fieldset disabled={busy || w.member.role !== "Admin"}>
            <TeamSettings workspace={w} run={run} busy={busy || w.member.role !== "Admin"} actionError={error} />
          </fieldset>
        ) : (
          !notice && <p role="status">{pending || current ? "Loading workspace…" : "Workspace unavailable."}</p>
        )}
      </WorkspaceSettingsLayout>
    );
  }
  const day = params.get("day");
  const plannedDay = day && Number.isFinite(Date.parse(day)) ? new Date(day) : undefined;
  const content = (
    <>
      {notice}
      {w ? (
        postId && !item ? (
          <p>Post unavailable.</p>
        ) : view === "detail" && item ? (
          <fieldset disabled={busy}>
            <PostDetail
              key={item.id}
              workspace={w}
              post={item}
              run={run}
              queue={params.get("review") === "1" && w.states.some((s) => s.id === item.stateId && s.kind === "review")}
              edit={() => router.push(href("/posts/" + item.id + "/edit"))}
            />
          </fieldset>
        ) : canEdit && (view === "compose" || view === "edit") ? (
          <fieldset disabled={busy}>
            <PostEditor
              key={`${item?.id ?? "draft"}:${reload}`}
              workspace={w}
              post={item}
              plannedDay={plannedDay}
              run={run}
              close={() => router.push(item ? postHref(item.id) : href("/"))}
            />
          </fieldset>
        ) : (
          <p>Workspace unavailable.</p>
        )
      ) : (
        <p role="status">
          {!pending && !current ? "Workspace unavailable." : query.isError ? null : "Loading workspace…"}
        </p>
      )}
    </>
  );
  if (embedded) return content;
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] py-6">
        <BackLink
          href={view === "edit" && postId ? postHref(postId) : href("/")}
          label={view === "edit" ? "Back to post" : "Back to posts"}
        />
        {view === "edit" && <h1 className="my-6 text-xl font-semibold tracking-tight">Edit post</h1>}
        <div className="mt-4">{content}</div>
      </main>
    </div>
  );
}
