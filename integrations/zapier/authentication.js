const { DEFAULT_BASE_URL, listAccounts, normalizeBaseUrl } = require('./lib/simplepost');

// API keys have no user-info endpoint, so the label names the social accounts
// the key can reach, plus the host for a self-hosted Scheduler.
const connectionLabel = (_z, bundle) => {
  const accounts = bundle.inputData.accounts || [];
  const first = accounts[0];
  const summary = first
    ? `${first.name}${accounts.length > 1 ? ` + ${accounts.length - 1} more` : ''}`
    : 'No connected accounts';
  const baseUrl = normalizeBaseUrl(bundle.authData.baseUrl);
  return baseUrl === DEFAULT_BASE_URL ? summary : `${summary} (${new URL(baseUrl).host})`;
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      helpText: 'Create a key on the [API keys](https://app.simplepost.social/api-keys) page in SimplePost. Keys start with `sp_api_` and need a plan with API access.',
    },
    {
      key: 'baseUrl',
      label: 'SimplePost URL',
      type: 'string',
      required: false,
      default: DEFAULT_BASE_URL,
      helpText: 'Keep the default for SimplePost cloud. Change it only for a self-hosted SimplePost Scheduler, for example `https://simplepost.example.com`.',
    },
  ],
  test: async (z, bundle) => ({ accounts: await listAccounts(z, bundle) }),
  connectionLabel,
};
