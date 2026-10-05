import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { simplepostAuth } from '../auth';
import { simplepostRequest } from '../common/client';
import { flattenPost, postOutputSchema, SimplePostPost } from '../common/output';
import { buildPostContent, normalizeScheduledFor } from '../common/post';
import {
  accountIdsProperty,
  accountOptionsProperty,
  accountOverridesProperty,
  mediaProperty,
  messageProperty,
  threadProperty,
} from '../common/props';

type CreatePostResponse = {
  post: SimplePostPost;
  replayed?: boolean;
  warnings?: unknown[];
};

export const createPost = createAction({
  auth: simplepostAuth,
  name: 'create_post',
  classification: 'WRITE',
  displayName: 'Create Post',
  description: 'Publish now, schedule, or save a draft post to one or more social accounts.',
  audience: 'both',
  aiMetadata: {
    description:
      'Create a SimplePost post for one or more connected social accounts and either publish it immediately, schedule it for a future time, or save it as a draft. Run Validate Post first to check platform limits without creating anything. Each call creates a new post unless the same Idempotency Key is reused, which returns the original post instead.',
    idempotent: false,
  },
  props: {
    account_ids: accountIdsProperty('The social accounts to post to.'),
    posting_mode: Property.StaticDropdown({
      displayName: 'Posting Mode',
      required: true,
      defaultValue: 'now',
      display: 'cards',
      options: {
        disabled: false,
        options: [
          { label: 'Publish now', value: 'now', description: 'Publish as soon as the step runs', icon: 'send' },
          { label: 'Schedule', value: 'schedule', description: 'Publish at the Scheduled For time', icon: 'calendar' },
          { label: 'Save as draft', value: 'draft', description: 'Keep it in SimplePost for review', icon: 'file' },
        ],
      },
    }),
    scheduled_for: Property.DateTime({
      displayName: 'Scheduled For',
      description: 'Required when Posting Mode is Schedule. Must be in the future.',
      required: false,
    }),
    message: messageProperty(),
    media: mediaProperty(),
    thread: threadProperty(),
    account_options: accountOptionsProperty(),
    account_overrides: accountOverridesProperty(),
    repost_after_hours: Property.Number({
      displayName: 'Repost After (Hours)',
      description:
        'Automatically repost on X, Bluesky, Threads, and LinkedIn this many hours after publishing (1–720). Leave empty to use your SimplePost default.',
      required: false,
      advanced: true,
    }),
    quote_post_id: Property.ShortText({
      displayName: 'Quote Post ID',
      description:
        'ID of a published SimplePost post to quote on X, Bluesky, Threads, and LinkedIn. Use the Post ID output of an earlier Create Post step.',
      required: false,
      advanced: true,
    }),
    idempotency_key: Property.ShortText({
      displayName: 'Idempotency Key',
      description:
        'A value that is unique per post, such as the ID of the trigger item. If the step is retried with the same key, SimplePost returns the original post instead of posting twice.',
      required: false,
      advanced: true,
    }),
  },
  outputSchema: {
    fields: [
      ...postOutputSchema.fields,
      { key: 'replayed', label: 'Returned Existing Post', format: 'boolean' },
    ],
  },
  async run(context) {
    const props = context.propsValue;
    const postingMode = props.posting_mode;
    const body: Record<string, unknown> = {
      ...buildPostContent(props),
      postingMode,
    };

    if (postingMode === 'schedule') {
      body['scheduledFor'] = normalizeScheduledFor(props.scheduled_for);
    }
    if (props.repost_after_hours !== undefined && props.repost_after_hours !== null) {
      const delayHours = Number(props.repost_after_hours);
      if (!Number.isInteger(delayHours) || delayHours < 1 || delayHours > 720) {
        throw new Error('Repost After (Hours) must be a whole number between 1 and 720.');
      }
      body['repost'] = { enabled: true, delayHours };
    }
    if (props.quote_post_id?.trim()) body['quotePostId'] = props.quote_post_id.trim();
    if (props.idempotency_key?.trim()) body['idempotencyKey'] = props.idempotency_key.trim();

    const response = await simplepostRequest<CreatePostResponse>({
      auth: context.auth,
      method: HttpMethod.POST,
      path: '/api/v1/posts',
      body,
    });
    const output = {
      ...flattenPost(response.post),
      replayed: response.replayed === true,
      warnings: response.warnings ?? [],
    };

    // Publishing problems come back as a stored post with status "failed";
    // fail the step so the flow's error handling and retries apply.
    if (output.status === 'failed') {
      const failures = output.results
        .filter((result) => !result.success)
        .map((result) => `${result.platform ?? result.account_id}: ${result.error ?? 'failed'}`);
      throw new Error(
        `SimplePost could not publish post ${output.post_id}: ${output.error_message ?? 'publishing failed'}${
          failures.length > 0 ? ` (${failures.join('; ')})` : ''
        }`,
      );
    }

    return output;
  },
});
