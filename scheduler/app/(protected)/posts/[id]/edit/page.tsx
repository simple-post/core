"use client";

import { use } from "react";

import Link from "next/link";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { PostForm } from "@/components/post-form";
import { Button } from "@/components/ui/button";
import { usePost } from "@/hooks/use-posts";

export default function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: post, isLoading: loading } = usePost(id);

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
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <Link href="/">
              <Button variant="outline">Back to dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (post.status !== "scheduled" && post.status !== "draft" && post.status !== "failed") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Cannot edit this post</h1>
            <p className="text-muted-foreground text-sm">
              Only scheduled posts, drafts, and failed posts can be edited.
            </p>
            <Link href={`/posts/${id}`}>
              <Button variant="outline">Back to post</Button>
            </Link>
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
          <BackLink href={`/posts/${id}`} label="Back to post" />
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Edit</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              {post.status === "failed" ? (
                <>
                  Retry <span className="text-primary">failed post</span>
                </>
              ) : (
                <>
                  Update <span className="text-primary">{post.status === "draft" ? "draft" : "scheduled post"}</span>
                </>
              )}
            </h1>
          </div>
        </div>
        <PostForm mode={post.status === "failed" ? "retry" : "edit"} existingPost={post} />
      </main>
    </div>
  );
}
