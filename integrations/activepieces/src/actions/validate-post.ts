import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { accountIdsProperty, simplePostAuth } from '../lib/auth';
import { simplePostRequest, toSimplePostAuth } from '../lib/simplepost';

export const validatePost = createAction({
  auth: simplePostAuth,
  name: 'validate_post',
  displayName: 'Validate Post',
  description: 'Validates a SimplePost social media post without creating it.',
  props: {
    message: Property.LongText({ displayName: 'Message', required: false }),
    accountIds: accountIdsProperty(),
    media: Property.Json({ displayName: 'Media', required: false }),
    thread: Property.Json({ displayName: 'Thread', required: false }),
    accountOverrides: Property.Json({ displayName: 'Account Overrides', required: false }),
  },
  async run(context) {
    const body = { ...context.propsValue, message: context.propsValue.message ?? '' };
    return simplePostRequest({
      auth: toSimplePostAuth(context.auth),
      method: HttpMethod.POST,
      path: '/api/v1/validation',
      body,
    });
  },
});
