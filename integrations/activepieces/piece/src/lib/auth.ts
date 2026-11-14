import { PieceAuth, Property } from '@activepieces/pieces-framework';

import { DEFAULT_BASE_URL, listAccounts } from './common/client';

export const simplepostAuth = PieceAuth.CustomAuth({
  displayName: 'SimplePost Connection',
  description: `Connect SimplePost with an API key.

1. Sign in to SimplePost and open **API Keys** from the user menu, or go to https://app.simplepost.social/api-keys.
2. Enter a name such as "Activepieces", click **Create API key**, and copy the key (it starts with \`sp_api_\`).
3. Paste the key below.

API keys require a SimplePost plan that includes API access.`,
  required: true,
  props: {
    api_key: PieceAuth.SecretText({
      displayName: 'API Key',
      description: 'Your SimplePost API key. It starts with `sp_api_`.',
      required: true,
    }),
    base_url: Property.ShortText({
      displayName: 'Base URL',
      description: `Leave the default for SimplePost Cloud. Change it only if you self-host SimplePost, e.g. \`https://simplepost.example.com\`.`,
      required: false,
      defaultValue: DEFAULT_BASE_URL,
    }),
  },
  validate: async ({ auth }) => {
    try {
      await listAccounts(auth);
      return { valid: true };
    } catch {
      return {
        valid: false,
        error:
          'SimplePost rejected this API key. Check the key, the Base URL, and that your plan includes API access.',
      };
    }
  },
});
