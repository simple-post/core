import { createPostEventTrigger } from '../common/webhooks';

export const postFailed = createPostEventTrigger({
  name: 'post_failed',
  event: 'post.failed',
  postType: 'failed',
  displayName: 'Post Failed',
  description: 'Triggers when a SimplePost post fails to publish.',
  aiDescription:
    'Fires once each time a SimplePost post fails to publish to one or more of its accounts, whether it was published immediately or on schedule. The payload is the post with the error message and the outcome for each account.',
  sampleData: {
    event: 'post.failed',
    event_created_at: '2026-10-04T09:00:03.000Z',
    post_id: 'cmg8x2k4e0002sp0c7a1b2c3e',
    status: 'failed',
    message: 'Our autumn launch is live.',
    account_ids: ['cmg1acct0003i'],
    scheduled_for: '2026-10-04T09:00:00.000Z',
    published_at: null,
    created_at: null,
    error_message: 'Instagram needs to be reconnected.',
    post_urls: [],
    results: [
      {
        account_id: 'cmg1acct0003i',
        platform: 'instagram',
        success: false,
        platform_post_id: null,
        post_url: null,
        error: 'Instagram needs to be reconnected.',
        completed_at: '2026-10-04T09:00:02.000Z',
      },
    ],
  },
});
