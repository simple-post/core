import { createPostEventTrigger } from '../common/webhooks';

export const postPublished = createPostEventTrigger({
  name: 'post_published',
  event: 'post.published',
  postType: 'past',
  displayName: 'Post Published',
  description: 'Triggers when a SimplePost post is published.',
  aiDescription:
    'Fires once each time a SimplePost post finishes publishing, whether it was published immediately or on schedule, from any SimplePost surface. The payload is the post with its published URL for each account.',
  sampleData: {
    event: 'post.published',
    event_created_at: '2026-10-04T09:00:02.000Z',
    post_id: 'cmg8x2k4e0001sp0c7a1b2c3d',
    status: 'published',
    message: 'We just shipped scheduled threads for Bluesky.',
    account_ids: ['cmg1acct0001x', 'cmg1acct0002b'],
    scheduled_for: null,
    published_at: '2026-10-04T09:00:01.000Z',
    created_at: null,
    error_message: null,
    post_urls: ['https://x.com/simplepost/status/1842000000000000000', 'https://bsky.app/profile/simplepost.social/post/3l5abc'],
    results: [
      {
        account_id: 'cmg1acct0001x',
        platform: 'x',
        success: true,
        platform_post_id: '1842000000000000000',
        post_url: 'https://x.com/simplepost/status/1842000000000000000',
        error: null,
        completed_at: '2026-10-04T09:00:01.000Z',
      },
      {
        account_id: 'cmg1acct0002b',
        platform: 'bluesky',
        success: true,
        platform_post_id: 'at://did:plc:abc/app.bsky.feed.post/3l5abc',
        post_url: 'https://bsky.app/profile/simplepost.social/post/3l5abc',
        error: null,
        completed_at: '2026-10-04T09:00:01.000Z',
      },
    ],
  },
});
