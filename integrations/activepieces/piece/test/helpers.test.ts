import { HttpError } from '@activepieces/pieces-common';

import {
  DEFAULT_BASE_URL,
  getCredentials,
  normalizeBaseUrl,
  toSimplePostError,
} from '../src/lib/common/client';
import { toMediaFiles, toThread } from '../src/lib/common/media';
import { flattenPost } from '../src/lib/common/output';
import { buildPostContent, normalizeScheduledFor } from '../src/lib/common/post';
import { accountLabel } from '../src/lib/common/props';

describe('client helpers', () => {
  test('defaults to SimplePost Cloud and trims self-hosted URLs', () => {
    expect(DEFAULT_BASE_URL).toBe('https://app.simplepost.social');
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl('  ')).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl('https://sp.example.com///')).toBe('https://sp.example.com');
  });

  test('reads credentials from validate input and connection values', () => {
    expect(getCredentials({ api_key: 'sp_api_a' })).toEqual({ api_key: 'sp_api_a' });
    expect(getCredentials({ props: { api_key: 'sp_api_b', base_url: 'https://x.test' } })).toEqual({
      api_key: 'sp_api_b',
      base_url: 'https://x.test',
    });
  });

  test('turns Scheduler API errors into readable messages', () => {
    const error = new HttpError({}, {
      status: 403,
      responseBody: { error: 'API access is not included in your Basic plan', code: 'FORBIDDEN' },
    });
    expect(toSimplePostError(error).message).toBe(
      'SimplePost API error 403 [FORBIDDEN]: API access is not included in your Basic plan',
    );

    const validation = new HttpError({}, {
      status: 400,
      responseBody: { error: 'Invalid post', code: 'VALIDATION_ERROR', details: { field: 'text' } },
    });
    expect(toSimplePostError(validation).message).toContain('Details: {"field":"text"}');
  });

  test('labels accounts by name, platform, and reconnect state', () => {
    expect(accountLabel({ id: 'a1', platform: 'twitter', username: 'simplepost' })).toBe('@simplepost (X)');
    expect(
      accountLabel({
        id: 'a2',
        platform: 'instagram',
        displayName: 'SimplePost',
        credentialStatus: { state: 'reauth_required' },
      }),
    ).toBe('SimplePost (Instagram) (reconnect required)');
  });
});

describe('media helpers', () => {
  test('builds media descriptors from URLs and detects the type', () => {
    const [image, video] = toMediaFiles([
      { url: 'https://cdn.test/a/photo.JPG' },
      { url: 'https://cdn.test/clip?id=1', type: 'video' },
    ])!;
    expect(image).toMatchObject({ url: 'https://cdn.test/a/photo.JPG', type: 'image', filename: 'photo.JPG', size: 0 });
    expect(image.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(video).toMatchObject({ type: 'video', filename: 'clip' });
  });

  test('accepts plain URL strings and rejects unknown types', () => {
    expect(toMediaFiles(['https://cdn.test/v.mov'])![0].type).toBe('video');
    expect(toMediaFiles([])).toBeUndefined();
    expect(() => toMediaFiles([{ url: 'https://cdn.test/file' }])).toThrow(/Set its Type/);
    expect(() => toMediaFiles([{ url: ' ' }])).toThrow(/needs a file URL/);
  });

  test('drops empty thread replies', () => {
    expect(toThread(['First reply', '  ', 'Second reply'])).toEqual([
      { message: 'First reply' },
      { message: 'Second reply' },
    ]);
    expect(toThread(['', ' '])).toBeUndefined();
  });
});

describe('post helpers', () => {
  test('sends only the fields the user set', () => {
    expect(buildPostContent({ account_ids: ['a1'], message: 'Hello' })).toEqual({
      message: 'Hello',
      accountIds: ['a1'],
    });
    expect(
      buildPostContent({
        account_ids: ['a1'],
        thread: ['Reply'],
        account_options: { a1: { title: 'T' } },
        account_overrides: {},
      }),
    ).toEqual({ message: '', accountIds: ['a1'], thread: [{ message: 'Reply' }], accountOptions: { a1: { title: 'T' } } });
  });

  test('requires accounts and object-shaped JSON settings', () => {
    expect(() => buildPostContent({ account_ids: [] })).toThrow(/at least one account/);
    expect(() => buildPostContent({ account_ids: ['a1'], account_options: ['x'] })).toThrow(/Platform Settings/);
  });

  test('normalizes schedule times to future UTC timestamps', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    expect(normalizeScheduledFor('2030-01-01T14:00:00+02:00', now)).toBe('2030-01-01T12:00:00.000Z');
    expect(() => normalizeScheduledFor(undefined, now)).toThrow(/Scheduled For/);
    expect(() => normalizeScheduledFor('not a date', now)).toThrow(/valid date/);
    expect(() => normalizeScheduledFor('2029-12-31T23:00:00Z', now)).toThrow(/in the future/);
  });
});

describe('output helpers', () => {
  test('flattens per-account results for tables', () => {
    expect(
      flattenPost({
        id: 'p1',
        status: 'published',
        message: 'Hi',
        publishedAt: '2030-01-01T00:00:00.000Z',
        accountResults: {
          a1: { accountId: 'a1', platform: 'x', success: true, postId: '9', postUrl: 'https://x.com/s/9' },
          a2: { accountId: 'a2', platform: 'bluesky', success: false, error: 'rate_limited', message: 'Slow down' },
        },
      }),
    ).toEqual({
      post_id: 'p1',
      status: 'published',
      message: 'Hi',
      account_ids: ['a1', 'a2'],
      scheduled_for: null,
      published_at: '2030-01-01T00:00:00.000Z',
      created_at: null,
      error_message: null,
      post_urls: ['https://x.com/s/9'],
      results: [
        {
          account_id: 'a1',
          platform: 'x',
          success: true,
          platform_post_id: '9',
          post_url: 'https://x.com/s/9',
          error: null,
          completed_at: null,
        },
        {
          account_id: 'a2',
          platform: 'bluesky',
          success: false,
          platform_post_id: null,
          post_url: null,
          error: 'Slow down',
          completed_at: null,
        },
      ],
    });
  });
});
