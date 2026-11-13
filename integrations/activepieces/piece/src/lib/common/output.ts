import { OutputSchema } from '@activepieces/pieces-framework';

export type AccountPublishResult = {
  accountId?: string;
  platform?: string;
  success?: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  message?: string;
  completedAt?: string;
};

export type SimplePostPost = {
  id: string;
  status: string;
  message?: string | null;
  accountIds?: string[];
  scheduledFor?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  errorMessage?: string | null;
  accountResults?: Record<string, AccountPublishResult> | null;
};

export type FlatAccountResult = {
  account_id: string;
  platform: string | null;
  success: boolean;
  platform_post_id: string | null;
  post_url: string | null;
  error: string | null;
  completed_at: string | null;
};

export type FlatPost = {
  post_id: string;
  status: string;
  message: string;
  account_ids: string[];
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string | null;
  error_message: string | null;
  post_urls: string[];
  results: FlatAccountResult[];
};

export function flattenAccountResults(
  accountResults: Record<string, AccountPublishResult> | null | undefined,
): FlatAccountResult[] {
  return Object.entries(accountResults ?? {}).map(([accountId, result]) => ({
    account_id: result.accountId ?? accountId,
    platform: result.platform ?? null,
    success: result.success === true,
    platform_post_id: result.postId ?? null,
    post_url: result.postUrl ?? null,
    error: result.success === true ? null : (result.message ?? result.error ?? null),
    completed_at: result.completedAt ?? null,
  }));
}

// Flat, table-friendly shape for the builder's data selector and for agents.
export function flattenPost(post: SimplePostPost): FlatPost {
  const results = flattenAccountResults(post.accountResults);
  return {
    post_id: post.id,
    status: post.status,
    message: post.message ?? '',
    account_ids: post.accountIds ?? results.map((result) => result.account_id),
    scheduled_for: post.scheduledFor ?? null,
    published_at: post.publishedAt ?? null,
    created_at: post.createdAt ?? null,
    error_message: post.errorMessage ?? null,
    post_urls: results.flatMap((result) => (result.post_url ? [result.post_url] : [])),
    results,
  };
}

export const postOutputSchema: OutputSchema = {
  fields: [
    { key: 'post_id', label: 'Post ID' },
    { key: 'status', label: 'Status' },
    { key: 'message', label: 'Text' },
    { key: 'scheduled_for', label: 'Scheduled For', format: 'datetime' },
    { key: 'published_at', label: 'Published At', format: 'datetime' },
    { key: 'error_message', label: 'Error' },
    { key: 'post_urls', label: 'Post URLs' },
    {
      key: 'results',
      label: 'Results per Account',
      labelKey: 'platform',
      listItems: [
        { key: 'account_id', label: 'Account ID' },
        { key: 'platform', label: 'Platform' },
        { key: 'success', label: 'Published', format: 'boolean' },
        { key: 'post_url', label: 'Post URL', format: 'url' },
        { key: 'error', label: 'Error' },
      ],
    },
  ],
};
