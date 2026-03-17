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
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/4" />
            <div className="h-64 bg-muted rounded" />
            <div className="h-32 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <Link href="/">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (post.status !== "scheduled") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Cannot edit published post</h1>
            <p className="text-muted-foreground">Only scheduled posts can be edited.</p>
            <Link href={`/posts/${id}`}>
              <Button variant="outline">Back to Post</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-4">
          <BackLink href={`/posts/${id}`} label="Back to post" />
        </div>
        <PostForm mode="edit" existingPost={post} />
      </main>
    </div>
  );
}
