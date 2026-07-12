const normalizeBaseUrl = (baseUrl) => (baseUrl || 'https://app.simplepost.social').replace(/\/+$/, '');

// The Scheduler API only accepts UTC `Z` timestamps, while Zapier datetime
// fields commonly deliver offset ISO strings.
const normalizeScheduledFor = (value) => {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Scheduled For must be a valid date and time.');
  }
  return parsed.toISOString();
};

const request = async (z, bundle, options) => {
  const response = await z.request({
    ...options,
    url: `${normalizeBaseUrl(bundle.authData.baseUrl)}${options.path}`,
  });

  if (response.status >= 400) {
    throw new z.errors.Error(response.data?.error || response.data?.message || 'SimplePost API request failed',
      'SimplePostError', response.status);
  }

  return response.data;
};

const parseJson = (value, fieldName, expected = 'object') => {
  if (!value) return undefined;

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

const createPostPayload = (inputData) => {
  const payload = {
    message: inputData.message || '',
    accountIds: inputData.accountIds,
    postingMode: inputData.postingMode,
  };

  if (inputData.postingMode === 'schedule') payload.scheduledFor = normalizeScheduledFor(inputData.scheduledFor);

  const media = parseJson(inputData.mediaJson, 'Media', 'array');
  const thread = parseJson(inputData.threadJson, 'Thread', 'array');
  const accountOptions = parseJson(inputData.accountOptionsJson, 'Account Options');
  const accountOverrides = parseJson(inputData.accountOverridesJson, 'Account Overrides');

  if (media) payload.media = media;
  if (thread) payload.thread = thread;
  if (accountOptions) payload.accountOptions = accountOptions;
  if (accountOverrides) payload.accountOverrides = accountOverrides;
  if (inputData.quotePostId) payload.quotePostId = inputData.quotePostId;
  if (inputData.idempotencyKey) payload.idempotencyKey = inputData.idempotencyKey;

  if (String(inputData.repostEnabled) === 'true') {
    payload.repost = {
      enabled: true,
      delayHours: Number(inputData.repostDelayHours || 12),
    };
  }

  return payload;
};

const listAccounts = async (z, bundle) => {
  const { accounts } = await request(z, bundle, { method: 'GET', path: '/api/v1/accounts' });
  return accounts.map((account) => ({
    id: account.id,
    name: account.displayName || account.username || account.platformAccountId || account.id,
    platform: account.platform,
    username: account.username,
  }));
};

module.exports = { createPostPayload, listAccounts, normalizeBaseUrl, normalizeScheduledFor, parseJson, request };
