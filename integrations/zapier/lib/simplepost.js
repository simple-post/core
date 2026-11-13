const DEFAULT_BASE_URL = 'https://app.simplepost.social';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'mpeg', 'mpg']);
const MAX_LISTED_ISSUES = 3;

// Self-hosted Schedulers are allowed, but the key must only ever be sent to
// an HTTPS origin (or a local development server), never to a lookalike path.
const normalizeBaseUrl = (baseUrl) => {
  const value = String(baseUrl || '').trim() || DEFAULT_BASE_URL;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SimplePost URL must be a full URL such as https://app.simplepost.social.');
  }

  const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('SimplePost URL must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('SimplePost URL must not contain credentials, a query string, or a fragment.');
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
};

// The Scheduler API only accepts UTC `Z` timestamps, while Zapier datetime
// fields commonly deliver offset ISO strings.
const normalizeScheduledFor = (value) => {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Schedule for must be a valid date and time.');
  }
  return parsed.toISOString();
};

const issueMessages = (details) => {
  const issues = [...(details?.summary?.errors || []), ...(details?.errors || [])];
  return [...new Set(issues.map((issue) => issue?.message).filter(Boolean))];
};

// Turns a Scheduler error response into a message a Zap owner can act on.
const describeApiError = (status, data) => {
  const base = data?.error || data?.message || `SimplePost responded with HTTP ${status}.`;
  const issues = issueMessages(data?.details);
  if (issues.length === 0) return base;

  const listed = issues.slice(0, MAX_LISTED_ISSUES).join(' ');
  const more = issues.length > MAX_LISTED_ISSUES ? ` (+${issues.length - MAX_LISTED_ISSUES} more)` : '';
  return issues.includes(base) ? `${listed}${more}` : `${base} ${listed}${more}`;
};

const request = async (z, bundle, { path, headers, ignoreStatuses = [], ...options }) => {
  const response = await z.request({
    ...options,
    url: `${normalizeBaseUrl(bundle.authData.baseUrl)}${path}`,
    headers: {
      Accept: 'application/json',
      ...headers,
      Authorization: `Bearer ${bundle.authData.apiKey}`,
    },
    skipThrowForStatus: true,
  });

  if (ignoreStatuses.includes(response.status)) return null;

  if (response.status === 401) {
    throw new z.errors.ExpiredAuthError('Your SimplePost API key is invalid or has been revoked. Reconnect SimplePost with a new key.');
  }

  if (response.status >= 400) {
    throw new z.errors.Error(describeApiError(response.status, response.data), response.data?.code || 'SimplePostError', response.status);
  }

  return response.data;
};

const parseJson = (value, fieldName, expected = 'object') => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') return value;

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }

  if (expected === 'array' ? !Array.isArray(parsed) : Array.isArray(parsed) || !parsed || typeof parsed !== 'object') {
    throw new Error(`${fieldName} must be a JSON ${expected}.`);
  }

  return parsed;
};

const toList = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
};

const filenameFromUrl = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'media');
  } catch {
    return 'media';
  }
};

const mediaTypeFromContentType = (contentType) => {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return undefined;
};

const mediaTypeFromFilename = (filename) => {
  const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  return VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image';
};

const hashString = (value) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
};

// Reads only the response headers: a one-byte range GET also works for
// presigned storage URLs (Zapier's stashed files among them), which reject HEAD.
const probeMedia = async (z, url) => {
  try {
    const response = await z.request({
      url,
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      raw: true,
      skipThrowForStatus: true,
    });
    response.body?.destroy?.();
    if (response.status >= 400) return {};

    const range = /\/(\d+)$/.exec(response.headers.get('content-range') || '');
    const length = response.status === 200 ? response.headers.get('content-length') : undefined;
    return {
      contentType: response.headers.get('content-type') || undefined,
      size: Number.parseInt(range?.[1] || length || '0', 10) || 0,
    };
  } catch {
    return {};
  }
};

// The Scheduler imports external media into its own storage when the post is
// created, so a media item only needs a reachable URL and a declared type.
// The type comes from the file's Content-Type and falls back to the extension.
const resolveMediaUrl = async (z, url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Media "${url}" must be a public file URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Media "${url}" must be a public file URL.`);
  }

  const { contentType, size = 0 } = await probeMedia(z, url);

  const filename = filenameFromUrl(url);
  const type = mediaTypeFromContentType(contentType) || mediaTypeFromFilename(filename);
  return {
    id: `zapier-${(hashString(url) >>> 0).toString(16)}`,
    url,
    type,
    filename,
    size,
    ...(mediaTypeFromContentType(contentType) ? { contentType: contentType.split(';')[0].trim() } : {}),
  };
};

const buildContentPayload = async (z, inputData) => {
  const payload = {
    message: inputData.message || '',
    accountIds: toList(inputData.accountIds),
  };

  const mediaUrls = toList(inputData.mediaUrls);
  const mediaJson = parseJson(inputData.mediaJson, 'Media (JSON)', 'array');
  const media = [...(await Promise.all(mediaUrls.map((url) => resolveMediaUrl(z, url)))), ...(mediaJson || [])];
  if (media.length > 0) payload.media = media;

  const threadMessages = toList(inputData.threadMessages).map((message) => ({ message }));
  const threadJson = parseJson(inputData.threadJson, 'Thread (JSON)', 'array');
  const thread = [...threadMessages, ...(threadJson || [])];
  if (thread.length > 0) payload.thread = thread;

  const accountOptions = parseJson(inputData.accountOptionsJson, 'Account options (JSON)');
  const accountOverrides = parseJson(inputData.accountOverridesJson, 'Account overrides (JSON)');
  if (accountOptions) payload.accountOptions = accountOptions;
  if (accountOverrides) payload.accountOverrides = accountOverrides;
  if (inputData.imageFit) payload.imageFit = inputData.imageFit;

  return payload;
};

const createPostPayload = async (z, inputData) => {
  const postingMode = inputData.postingMode || 'now';
  const payload = { ...(await buildContentPayload(z, inputData)), postingMode };

  if (postingMode === 'schedule') payload.scheduledFor = normalizeScheduledFor(inputData.scheduledFor);
  if (inputData.quotePostId) payload.quotePostId = String(inputData.quotePostId);
  if (inputData.idempotencyKey) payload.idempotencyKey = String(inputData.idempotencyKey);

  if (String(inputData.repostEnabled) === 'true') {
    payload.repost = {
      enabled: true,
      delayHours: Number(inputData.repostDelayHours || 12),
    };
  }

  return payload;
};

const postUrl = (bundle, id) => `${normalizeBaseUrl(bundle.authData.baseUrl)}/posts/${id}`;

const toDateString = (value) => (value ? new Date(value).toISOString() : null);

// accountResults is keyed by account ID; Zapier maps arrays of flat objects
// to line items, which is easier to use in later steps.
const toAccountResults = (accountResults) => Object.values(accountResults || {}).map((result) => ({
  accountId: result.accountId,
  platform: result.platform,
  success: Boolean(result.success),
  postUrl: result.postUrl || null,
  error: result.success ? null : result.message || result.error || null,
}));

// Every post event, from a webhook or from the polling fallback, is reduced
// to the same keys so Zap field mappings work identically for both.
const toPostEvent = (bundle, event, post, createdAt) => ({
  id: post.id,
  event,
  eventCreatedAt: toDateString(createdAt) || new Date().toISOString(),
  status: post.status,
  message: post.message || '',
  url: postUrl(bundle, post.id),
  publishedAt: toDateString(post.publishedAt),
  errorMessage: post.errorMessage || null,
  accountResults: toAccountResults(post.accountResults),
});

const toPostOutput = (bundle, body) => {
  const post = body.post || {};
  return {
    id: post.id,
    status: post.status,
    message: post.message || '',
    url: postUrl(bundle, post.id),
    scheduledFor: toDateString(post.scheduledFor),
    publishedAt: toDateString(post.publishedAt),
    createdAt: toDateString(post.createdAt),
    accountIds: post.accountIds || [],
    errorMessage: post.errorMessage || null,
    accountResults: toAccountResults(post.accountResults),
    replayed: Boolean(body.replayed),
    warnings: (body.warnings || []).map((warning) => (typeof warning === 'string' ? warning : warning?.message)).filter(Boolean),
  };
};

const failedPublishMessage = (output) => {
  const failed = output.accountResults.filter((result) => !result.success);
  const published = output.accountResults.filter((result) => result.success);
  const failures = failed.map((result) => `${result.platform}: ${result.error || 'failed'}`).join('; ');
  const partial = published.length > 0
    ? ` It was published to ${published.map((result) => result.platform).join(', ')}.`
    : '';
  return `SimplePost could not publish post ${output.id}. ${failures || output.errorMessage || 'Publishing failed.'}${partial} Review it at ${output.url}`;
};

const accountLabel = (account) => {
  const handle = account.username ? `@${String(account.username).replace(/^@/, '')}` : undefined;
  const name = account.displayName || handle || account.platformAccountId || account.id;
  const suffix = handle && handle !== name ? ` (${handle})` : '';
  return `${name}${suffix} · ${account.platform}`;
};

const toAccount = (account) => ({
  id: account.id,
  name: accountLabel(account),
  platform: account.platform,
  username: account.username || null,
  displayName: account.displayName || null,
  needsReconnect: account.credentialStatus?.state === 'reauth_required',
});

// Preview-only accounts can be shown in SimplePost but cannot publish.
const listAccounts = async (z, bundle) => {
  const { accounts } = await request(z, bundle, { method: 'GET', path: '/api/v1/accounts' });
  return (accounts || []).filter((account) => !account.previewOnly).map(toAccount);
};

module.exports = {
  DEFAULT_BASE_URL,
  accountLabel,
  buildContentPayload,
  createPostPayload,
  describeApiError,
  failedPublishMessage,
  listAccounts,
  normalizeBaseUrl,
  normalizeScheduledFor,
  parseJson,
  postUrl,
  request,
  resolveMediaUrl,
  toAccount,
  toPostEvent,
  toPostOutput,
};
