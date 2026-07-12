import { axios } from '@pipedream/platform';

const normalizeBaseUrl = (baseUrl) => (baseUrl || 'https://app.simplepost.social').replace(/\/+$/, '');

export default {
  type: 'app',
  app: 'simplepost',
  propDefinitions: {
    apiKey: {
      type: 'string',
      label: 'API Key',
      description: 'Create an API key in SimplePost under API Keys.',
      secret: true,
    },
    baseUrl: {
      type: 'string',
      label: 'Base URL',
      description: 'The hosted SimplePost URL or URL of your self-hosted Scheduler app.',
      default: 'https://app.simplepost.social',
    },
  },
  methods: {
    _baseUrl() {
      return normalizeBaseUrl(this.baseUrl);
    },
    async _request($, config) {
      return axios($, {
        ...config,
        url: `${this._baseUrl()}${config.path}`,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
    },
    async listAccounts($) {
      const { accounts } = await this._request($, { method: 'GET', path: '/api/v1/accounts' });
      return accounts;
    },
    async createPost($, body) {
      return this._request($, { method: 'POST', path: '/api/v1/posts', data: body });
    },
    async validatePost($, body) {
      return this._request($, { method: 'POST', path: '/api/v1/validation', data: body });
    },
  },
};

export { normalizeBaseUrl };
