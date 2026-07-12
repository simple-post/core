import { createPiece, PieceAuth } from '@activepieces/pieces-framework';

import { createPost } from './actions/create-post';
import { validatePost } from './actions/validate-post';

export const simplepost = createPiece({
  displayName: 'SimplePost',
  description: 'Publish and schedule social media posts with SimplePost.',
  minimumSupportedRelease: '0.82.0',
  logoUrl: 'https://app.simplepost.social/favicon-32x32.png',
  authors: ['simple-post'],
  auth: PieceAuth.SecretText({
    displayName: 'API Key',
    description: 'Create an API key in SimplePost under API Keys.',
    required: true,
  }),
  actions: [createPost, validatePost],
  triggers: [],
});
