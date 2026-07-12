import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { DEFAULT_BASE_URL, simplePostRequest } from '../lib/simplepost';

export const validatePost = createAction({
  name: 'validate_post',
  displayName: 'Validate Post',
  description: 'Validates a SimplePost social media post without creating it.',
  props: {
    baseUrl: Property.ShortText({ displayName: 'Base URL', required: false, defaultValue: DEFAULT_BASE_URL }),
    message: Property.LongText({ displayName: 'Message', required: false }),
    accountIds: Property.Json({ displayName: 'Account IDs', description: 'JSON array of connected SimplePost account IDs.', required: true }),
    media: Property.Json({ displayName: 'Media', required: false }),
    thread: Property.Json({ displayName: 'Thread', required: false }),
    accountOverrides: Property.Json({ displayName: 'Account Overrides', required: false }),
  },
  async run(context) {
    const { baseUrl, ...body } = context.propsValue;
    return simplePostRequest({
      apiKey: (context.auth as { secret_text: string }).secret_text,
      baseUrl,
      method: HttpMethod.POST,
      path: '/api/v1/validation',
      body,
    });
  },
});
