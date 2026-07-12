import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { DEFAULT_BASE_URL, simplePostRequest } from '../lib/simplepost';

export const createPost = createAction({
  name: 'create_post',
  displayName: 'Create Post',
  description: 'Publishes immediately, schedules, or saves a SimplePost social media post.',
  props: {
    baseUrl: Property.ShortText({
      displayName: 'Base URL',
      description: 'The hosted SimplePost URL or URL of your self-hosted Scheduler app.',
      required: false,
      defaultValue: DEFAULT_BASE_URL,
    }),
    message: Property.LongText({ displayName: 'Message', required: false }),
    accountIds: Property.Json({
      displayName: 'Account IDs',
      description: 'JSON array of connected SimplePost account IDs.',
      required: true,
    }),
    postingMode: Property.StaticDropdown({
      displayName: 'Posting Mode',
      required: true,
      defaultValue: 'now',
      options: {
        disabled: false,
        options: [
          { label: 'Publish Now', value: 'now' },
          { label: 'Schedule', value: 'schedule' },
          { label: 'Save as Draft', value: 'draft' },
        ],
      },
    }),
    scheduledFor: Property.DateTime({
      displayName: 'Scheduled For',
      description: 'Required when Posting Mode is Schedule.',
      required: false,
    }),
    media: Property.Json({ displayName: 'Media', description: 'Optional SimplePost media array.', required: false }),
    thread: Property.Json({ displayName: 'Thread', description: 'Optional array of additional thread segments.', required: false }),
    accountOptions: Property.Json({ displayName: 'Account Options', description: 'Optional platform options keyed by account ID.', required: false }),
    accountOverrides: Property.Json({ displayName: 'Account Overrides', description: 'Optional content overrides keyed by account ID.', required: false }),
    repost: Property.Json({ displayName: 'Repost', description: 'Optional repost settings.', required: false }),
    quotePostId: Property.ShortText({ displayName: 'Quote Post ID', required: false }),
    idempotencyKey: Property.ShortText({ displayName: 'Idempotency Key', description: 'Stable value that prevents duplicate posts on retry.', required: false }),
  },
  async run(context) {
    const { baseUrl, ...body } = context.propsValue;
    return simplePostRequest({
      apiKey: (context.auth as { secret_text: string }).secret_text,
      baseUrl,
      method: HttpMethod.POST,
      path: '/api/v1/posts',
      body,
    });
  },
});
