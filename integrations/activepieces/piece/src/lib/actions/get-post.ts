import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { simplepostAuth } from '../auth';
import { simplepostRequest } from '../common/client';
import { flattenPost, postOutputSchema, SimplePostPost } from '../common/output';

export const getPost = createAction({
  auth: simplepostAuth,
  name: 'get_post',
  classification: 'READ',
  displayName: 'Get Post',
  description: 'Get the status, schedule, and published links of a SimplePost post.',
  audience: 'both',
  aiMetadata: {
    description:
      'Fetch one SimplePost post by its ID, including its status (draft, scheduled, pending, published, or failed), schedule time, error message, and the published URL for each account. Use it to check on a post created earlier. Safe to retry.',
    idempotent: true,
  },
  props: {
    post_id: Property.ShortText({
      displayName: 'Post ID',
      description: 'The Post ID output of a Create Post step or a SimplePost trigger.',
      required: true,
    }),
  },
  outputSchema: postOutputSchema,
  async run(context) {
    const postId = context.propsValue.post_id.trim();
    const { post } = await simplepostRequest<{ post: SimplePostPost }>({
      auth: context.auth,
      method: HttpMethod.GET,
      path: `/api/v1/posts/${encodeURIComponent(postId)}`,
    });
    return flattenPost(post);
  },
});
