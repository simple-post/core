import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { accountIdsProperty, simplePostAuth } from '../lib/auth';
import { normalizeScheduledFor, simplePostRequest, toSimplePostAuth } from '../lib/simplepost';

export const createPost = createAction({
  auth: simplePostAuth,
  name: 'create_post',
  displayName: 'Create Post',
  description: 'Publishes immediately, schedules, or saves a SimplePost social media post.',
  props: {
    message: Property.LongText({ displayName: 'Message', required: false }),
    accountIds: accountIdsProperty(),
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
    const { scheduledFor, ...rest } = context.propsValue;
    const body: Record<string, unknown> = { ...rest, message: rest.message ?? '' };
    if (rest.postingMode === 'schedule') {
      body['scheduledFor'] = normalizeScheduledFor(scheduledFor);
    }

    return simplePostRequest({
      auth: toSimplePostAuth(context.auth),
      method: HttpMethod.POST,
      path: '/api/v1/posts',
      body,
    });
  },
});
