"use client";

import { use, useEffect } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { PostForm } from "@/components/post-form";
import { Button } from "@/components/ui/button";
import { UiCopy } from "@/components/ui-copy";
import { usePost } from "@/hooks/use-posts";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export default function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { copy } = useUiCopy();
  const { id } = use(params);
  const router = useRouter();
  const { data: post, isLoading: loading } = usePost(id);
  const canEdit = post?.status === "scheduled" || post?.status === "draft" || post?.status === "failed";

  useEffect(() => {
    if (post && !canEdit) {
      router.replace("/?tab=past");
    }
  }, [canEdit, post, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-secondary rounded w-1/4" />
            <div className="h-64 bg-secondary rounded" />
            <div className="h-32 bg-secondary rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">{copy("Post not found")}</h1>
            <Link href="/">
              <Button variant="outline">{copy("Back to dashboard")}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-secondary rounded w-1/4" />
            <div className="h-64 bg-secondary rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 space-y-3 animate-reveal">
          <BackLink href={`/posts/${id}`} label={copy("Back to post")} />
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">{copy("Edit")}</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              {post.status === "failed" ? (
                <UiCopy
                  source="Retry <part1>failed post</part1>"
                  components={{ part1: <span className="text-primary" /> }}
                />
              ) : post.status === "draft" ? (
                <UiCopy
                  source="Update <part1>draft</part1>"
                  components={{ part1: <span className="text-primary" /> }}
                />
              ) : (
                <UiCopy
                  source="Update <part1>scheduled post</part1>"
                  components={{ part1: <span className="text-primary" /> }}
                />
              )}
            </h1>
          </div>
        </div>
        <PostForm mode={post.status === "failed" ? "retry" : "edit"} existingPost={post} />
      </main>
    </div>
  );
}
