"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { PostForm } from "@/components/post-form";
import { usePost } from "@/hooks/use-post";

export default function EditPostPage({ params }: { params: { id: string } }) {
  const { post, loading } = usePost(params.id);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
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
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (post.status !== "scheduled") {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Cannot edit published post</h1>
            <p className="text-muted-foreground">Only scheduled posts can be edited.</p>
            <Link href={`/posts/${params.id}`}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Post
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-foreground">Edit Post</h1>
              <p className="text-muted-foreground">Make changes to your scheduled post</p>
            </div>
            <Link href={`/posts/${params.id}`}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-12">
        <PostForm mode="edit" existingPost={post} />
      </main>
    </div>
  );
}
