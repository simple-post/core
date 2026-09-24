"use client";

import type React from "react";
import { use } from "react";

import { buildExistingPostDraft, getExistingPostMode } from "@/components/edit-post-draft";
import { PostDraftProvider } from "@/components/post-draft-context";
import { usePost } from "@/hooks/use-posts";

/**
 * Keeps the edited post's draft above the composer and its customize pages,
 * so moving between them keeps unsaved changes.
 */
export default function EditPostLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: post } = usePost(id);

  if (!post) return children;

  return (
    <PostDraftProvider key={post.id} initialDraft={buildExistingPostDraft(post, getExistingPostMode(post))}>
      {children}
    </PostDraftProvider>
  );
}
