import { axios } from '@pipedream/platform';

import { normalizeBaseUrl } from './common.mjs';

export default {
  type: 'app',
  app: 'simplepost',
  propDefinitions: {
    accountIds: {
      type: 'string[]',
      label: 'Account IDs',
      description: 'One or more connected SimplePost account IDs.',
      async options({ page }) {
        const accounts = await this.listAccounts();
        return accounts.map((account) => ({
          label: `${account.displayName || account.username || account.id} (${account.platform})`,
          value: account.id,
        })).slice(page * 100, (page + 1) * 100);
      },
    },
  },
  methods: {
    _baseUrl() {
      return normalizeBaseUrl(this.$auth.base_url);
    },
    async _request($, config) {
      return axios($, {
        ...config,
        url: `${this._baseUrl()}${config.path}`,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${this.$auth.api_key}`,
        },
      });
    },
    async listAccounts($ = this) {
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
