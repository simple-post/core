import { createHmac, timingSafeEqual } from 'node:crypto';

import { createTrigger, TriggerStrategy } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { simplepostAuth } from '../auth';
import { simplepostRequest, SimplePostAuthValue } from './client';
import { flattenPost, FlatPost, postOutputSchema, SimplePostPost } from './output';

export type SimplePostWebhookEvent = 'post.published' | 'post.failed';

type WebhookPayload = {
  event: SimplePostWebhookEvent;
  createdAt: string;
  post: SimplePostPost;
};

type StoredWebhook = { id: string; secret: string };

const STORE_KEY = 'simplepost_webhook';

function header(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match ? headers[match] : undefined;
}

function rawBodyText(rawBody: unknown, body: unknown): string {
  if (typeof rawBody === 'string') return rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  // SimplePost sends JSON.stringify output, so re-serializing the parsed body
  // reproduces the signed bytes when the raw body is unavailable.
  return typeof body === 'string' ? body : JSON.stringify(body);
}

// SimplePost signs `${timestamp}.${body}` with HMAC-SHA256 and sends it as
// `X-SimplePost-Signature: sha256=<hex>` next to `X-SimplePost-Timestamp`.
export function verifySimplePostSignature(params: {
  secret: string;
  headers: Record<string, string>;
  rawBody: unknown;
  body: unknown;
}): boolean {
  const signature = header(params.headers, 'x-simplepost-signature');
  const timestamp = header(params.headers, 'x-simplepost-timestamp');
  if (!signature?.startsWith('sha256=') || !timestamp) return false;

  const expected = createHmac('sha256', params.secret)
    .update(`${timestamp}.${rawBodyText(params.rawBody, params.body)}`)
    .digest('hex');
  const received = signature.slice('sha256='.length);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
}

export type PostEvent = FlatPost & {
  event: SimplePostWebhookEvent;
  event_created_at: string | null;
};

export function toPostEvent(event: SimplePostWebhookEvent, post: SimplePostPost, createdAt: string | null): PostEvent {
  return { event, event_created_at: createdAt, ...flattenPost(post) };
}

async function registerWebhook(auth: SimplePostAuthValue, url: string, event: SimplePostWebhookEvent) {
  const { webhook } = await simplepostRequest<{ webhook: StoredWebhook }>({
    auth,
    method: HttpMethod.POST,
    path: '/api/v1/webhooks',
    body: { url, events: [event] },
  });
  return webhook;
}

async function deleteWebhook(auth: SimplePostAuthValue, id: string) {
  try {
    await simplepostRequest({ auth, method: HttpMethod.DELETE, path: `/api/v1/webhooks/${encodeURIComponent(id)}` });
  } catch (error) {
    // Already removed in SimplePost; nothing left to clean up.
    if (error instanceof Error && error.message.startsWith('SimplePost API error 404')) return;
    throw error;
  }
}

export function createPostEventTrigger(params: {
  name: string;
  event: SimplePostWebhookEvent;
  displayName: string;
  description: string;
  aiDescription: string;
  postType: 'past' | 'failed';
  sampleData: PostEvent;
}) {
  return createTrigger({
    auth: simplepostAuth,
    name: params.name,
    classification: 'READ',
    displayName: params.displayName,
    description: params.description,
    aiMetadata: { description: params.aiDescription },
    props: {},
    type: TriggerStrategy.WEBHOOK,
    sampleData: params.sampleData,
    outputSchema: {
      fields: [{ key: 'event', label: 'Event' }, ...postOutputSchema.fields],
    },
    async onEnable(context) {
      const webhook = await registerWebhook(context.auth, context.webhookUrl, params.event);
      await context.store.put<StoredWebhook>(STORE_KEY, { id: webhook.id, secret: webhook.secret });
    },
    async onDisable(context) {
      const webhook = await context.store.get<StoredWebhook>(STORE_KEY);
      if (webhook?.id) {
        await deleteWebhook(context.auth, webhook.id);
      }
      await context.store.delete(STORE_KEY);
    },
    async test(context) {
      const { posts } = await simplepostRequest<{ posts: SimplePostPost[] }>({
        auth: context.auth,
        method: HttpMethod.GET,
        path: '/api/v1/posts',
        queryParams: { type: params.postType, page: '1', limit: '5' },
      });
      return posts.map((post) => toPostEvent(params.event, post, null));
    },
    async run(context) {
      const webhook = await context.store.get<StoredWebhook>(STORE_KEY);
      const { body, headers, rawBody } = context.payload;
      if (!webhook?.secret || !verifySimplePostSignature({ secret: webhook.secret, headers, rawBody, body })) {
        return [];
      }

      const payload = (typeof body === 'string' ? JSON.parse(body) : body) as WebhookPayload;
      if (payload?.event !== params.event || !payload.post?.id) {
        return [];
      }
      return [toPostEvent(payload.event, payload.post, payload.createdAt ?? null)];
    },
  });
}
