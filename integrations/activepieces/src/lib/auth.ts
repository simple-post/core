import { PieceAuth, Property } from '@activepieces/pieces-framework';

import { DEFAULT_BASE_URL, listAccounts, toSimplePostAuth } from './simplepost';

export const simplePostAuth = PieceAuth.CustomAuth({
  description: 'Create an API key in SimplePost under API Keys.',
  required: true,
  props: {
    apiKey: PieceAuth.SecretText({
      displayName: 'API Key',
      required: true,
    }),
    baseUrl: Property.ShortText({
      displayName: 'Base URL',
      description: 'The hosted SimplePost URL or the URL of your self-hosted Scheduler app.',
      required: true,
      defaultValue: DEFAULT_BASE_URL,
    }),
  },
  validate: async ({ auth }) => {
    try {
      await listAccounts(toSimplePostAuth(auth));
      return { valid: true };
    } catch {
      return { valid: false, error: 'Could not list connected accounts with this API key and base URL.' };
    }
  },
});

export const accountIdsProperty = () =>
  Property.MultiSelectDropdown({
    displayName: 'Accounts',
    description: 'Connected SimplePost accounts to use.',
    required: true,
    auth: simplePostAuth,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return { disabled: true, placeholder: 'Connect your SimplePost account first.', options: [] };
      }

      const accounts = await listAccounts(toSimplePostAuth(auth));
      return {
        disabled: false,
        options: accounts.map((account) => ({
          label: `${account.displayName || account.username || account.id} (${account.platform})`,
          value: account.id,
        })),
      };
    },
  });
