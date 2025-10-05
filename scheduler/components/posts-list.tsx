"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createPostsRepository, SOCIAL_PLATFORMS } from "@/lib/config";
import type { SocialPost, ConnectedAccount } from "@/lib/types";

interface PostsListProps {
  type: "scheduled" | "past";
}

function formatDate(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, "0");

  return `${months[date.getMonth()]} ${date.getDate()}, ${displayHours}:${displayMinutes} ${ampm}`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return formatDate(date);
}

export function PostsList({ type }: PostsListProps) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        // Load posts
        const repository = createPostsRepository();
        const data = type === "scheduled" ? await repository.getScheduledPosts() : await repository.getPastPosts();
        setPosts(data);

        // Load accounts
        const response = await fetch("/api/accounts");
        if (response.ok) {
          const accountsData = await response.json();
          setAccounts(accountsData.accounts || []);
        }
      } catch (error) {
        console.error("Failed to load posts:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [type]);

  if (loading) {
    return <PostsListSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="border border-border/50 rounded p-8 text-center">
        <div className="text-muted-foreground">
          <p className="text-sm">{type === "scheduled" ? "No scheduled posts" : "No published posts"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} accounts={accounts} />
      ))}
    </div>
  );
}

function PostCard({ post, accounts }: { post: SocialPost; accounts: ConnectedAccount[] }) {
  // Get accounts for this post
  const postAccounts = accounts.filter((acc) => post.accountIds.includes(acc.id));

  // Get unique platforms from the accounts
  const uniquePlatforms = Array.from(new Set(postAccounts.map((acc) => acc.platform)));
  const platformsWithNames = uniquePlatforms
    .map((platform) => SOCIAL_PLATFORMS.find((p) => p.id === platform))
    .filter(Boolean);

  const hasMedia = post.media.length > 0;
  const isScheduled = post.status === "scheduled";

  const getAccountDisplayName = (account: ConnectedAccount) => {
    if ((account.platform === "x" || account.platform === "tiktok") && account.username) {
      return `@${account.username}`;
    }
    return (
      account.displayName ||
      (account.username ? `@${account.username}` : null) ||
      account.email ||
      account.platformAccountId
    );
  };

  return (
    <div className="border border-border/50 rounded p-4 hover:border-border transition-colors">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {hasMedia ? (
            <div className="w-12 h-12 bg-muted rounded flex items-center justify-center relative overflow-hidden">
              {post.media[0].type === "image" ? (
                <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              ) : (
                <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              )}
              {post.media.length > 1 && (
                <div className="absolute -top-1 -right-1 h-4 w-4 bg-foreground text-background rounded-full text-xs flex items-center justify-center">
                  {post.media.length}
                </div>
              )}
            </div>
          ) : (
            <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
              <div className="text-sm font-mono text-muted-foreground">T</div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground line-clamp-2 mb-2">{post.message || "No message"}</p>

              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {isScheduled ? (
                  <span>{formatDate(post.scheduledFor)}</span>
                ) : (
                  <span>{formatTimeAgo(post.publishedAt || post.createdAt)}</span>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {postAccounts.slice(0, 2).map((account, idx) => {
                  const platformConfig = SOCIAL_PLATFORMS.find((p) => p.id === account.platform);
                  return (
                    <div key={account.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                      {platformConfig && <div className={`w-1 h-1 rounded-full ${platformConfig.color}`} />}
                      <span>{getAccountDisplayName(account)}</span>
                      {idx < Math.min(postAccounts.length - 1, 1) && <span>,</span>}
                    </div>
                  );
                })}
                {postAccounts.length > 2 && (
                  <div className="text-xs text-muted-foreground">+{postAccounts.length - 2} more</div>
                )}
              </div>
            </div>

            <Button variant="ghost" size="sm" className="flex-shrink-0 h-8 w-8 p-0">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostsListSkeleton() {
  return (
    <div className="grid gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="animate-pulse">
          <CardContent className="p-6">
            <div className="flex gap-4">
              <div className="w-16 h-16 bg-muted rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
                <div className="flex gap-2">
                  <div className="h-6 bg-muted rounded w-16" />
                  <div className="h-6 bg-muted rounded w-16" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
