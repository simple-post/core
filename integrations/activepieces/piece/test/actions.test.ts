import { createHmac } from 'node:crypto';

import { createMockActionContext } from '@activepieces/pieces-framework';
import { httpClient } from '@activepieces/pieces-common';

import { simplepost } from '../src';
import { createPost } from '../src/lib/actions/create-post';
import { validatePost } from '../src/lib/actions/validate-post';
import { verifySimplePostSignature } from '../src/lib/common/webhooks';

const auth = { type: 'CUSTOM_AUTH', props: { api_key: 'sp_api_test', base_url: 'https://sp.example.com/' } };

function actionContext(propsValue: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...createMockActionContext({ propsValue: propsValue as any }), auth } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('piece definition', () => {
  test('registers every action and trigger with AI metadata', () => {
    expect(Object.keys(simplepost.actions()).sort()).toEqual([
      'create_post',
      'custom_api_call',
      'get_post',
      'list_accounts',
      'upload_media',
      'validate_post',
    ]);
    expect(Object.keys(simplepost.triggers()).sort()).toEqual(['post_failed', 'post_published']);

    for (const action of Object.values(simplepost.actions())) {
      if (action.name === 'custom_api_call') continue;
      expect(action.audience, action.name).toBe('both');
      expect(action.classification, action.name).toBeDefined();
      expect(action.aiMetadata?.description, action.name).toBeTruthy();
      expect(typeof action.aiMetadata?.idempotent, action.name).toBe('boolean');
    }
    for (const trigger of Object.values(simplepost.triggers())) {
      expect(trigger.classification, trigger.name).toBe('READ');
      expect(trigger.aiMetadata?.description, trigger.name).toBeTruthy();
    }
  });
});

describe('create post', () => {
  test('schedules a post with the Scheduler API contract', async () => {
    const send = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
      status: 201,
      headers: {},
      body: {
        post: { id: 'p1', status: 'scheduled', message: 'Hi', accountIds: ['a1'], scheduledFor: '2099-01-01T12:00:00.000Z' },
        warnings: [],
      },
    });

    const output = await createPost.run(
      actionContext({
        account_ids: ['a1'],
        posting_mode: 'schedule',
        scheduled_for: '2099-01-01T14:00:00+02:00',
        message: 'Hi',
        media: [{ url: 'https://cdn.test/photo.png' }],
        repost_after_hours: 12,
        idempotency_key: ' row-42 ',
      }),
    );

    const request = send.mock.calls[0][0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://sp.example.com/api/v1/posts');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer sp_api_test', 'Content-Type': 'application/json' });
    expect(request.body).toMatchObject({
      message: 'Hi',
      accountIds: ['a1'],
      postingMode: 'schedule',
      scheduledFor: '2099-01-01T12:00:00.000Z',
      media: [{ url: 'https://cdn.test/photo.png', type: 'image', filename: 'photo.png', size: 0 }],
      repost: { enabled: true, delayHours: 12 },
      idempotencyKey: 'row-42',
    });
    expect(output).toMatchObject({ post_id: 'p1', status: 'scheduled', replayed: false });
  });

  test('fails the step when publishing fails', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
      status: 201,
      headers: {},
      body: {
        post: {
          id: 'p2',
          status: 'failed',
          errorMessage: 'Failed on 1 platform(s)',
          accountResults: { a1: { accountId: 'a1', platform: 'x', success: false, message: 'Duplicate content' } },
        },
      },
    });

    await expect(
      createPost.run(actionContext({ account_ids: ['a1'], posting_mode: 'now', message: 'Hi' })),
    ).rejects.toThrow('SimplePost could not publish post p2: Failed on 1 platform(s) (x: Duplicate content)');
  });
});

describe('validate post', () => {
  test('returns a flat validation summary', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
      status: 200,
      headers: {},
      body: {
        summary: {
          isValid: false,
          errors: [{ platform: 'x', severity: 'error', code: 'text_too_long', message: 'Too long', field: 'text' }],
          warnings: [],
        },
        results: [{ accountId: 'a1', platform: 'x', isValid: false }],
      },
    });

    await expect(validatePost.run(actionContext({ account_ids: ['a1'], message: 'x'.repeat(300) }))).resolves.toEqual({
      is_valid: false,
      errors: [{ platform: 'x', code: 'text_too_long', field: 'text', message: 'Too long' }],
      warnings: [],
      accounts: [{ account_id: 'a1', platform: 'x', is_valid: false }],
    });
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ event: 'post.published', createdAt: '2030-01-01T00:00:00.000Z', post: { id: 'p1' } });
  const timestamp = '1893456000000';
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

  test('accepts SimplePost signatures from the raw or parsed body', () => {
    const headers = { 'x-simplepost-signature': signature, 'x-simplepost-timestamp': timestamp };
    expect(verifySimplePostSignature({ secret, headers, rawBody: body, body: JSON.parse(body) })).toBe(true);
    expect(verifySimplePostSignature({ secret, headers, rawBody: Buffer.from(body), body: null })).toBe(true);
    expect(verifySimplePostSignature({ secret, headers, rawBody: undefined, body: JSON.parse(body) })).toBe(true);
    expect(
      verifySimplePostSignature({
        secret,
        headers: { 'X-SimplePost-Signature': signature, 'X-SimplePost-Timestamp': timestamp },
        rawBody: body,
        body: null,
      }),
    ).toBe(true);
  });

  test('rejects tampered or unsigned payloads', () => {
    const headers = { 'x-simplepost-signature': signature, 'x-simplepost-timestamp': timestamp };
    expect(verifySimplePostSignature({ secret: 'other', headers, rawBody: body, body: null })).toBe(false);
    expect(verifySimplePostSignature({ secret, headers, rawBody: body.replace('p1', 'p2'), body: null })).toBe(false);
    expect(verifySimplePostSignature({ secret, headers: {}, rawBody: body, body: null })).toBe(false);
  });
});
