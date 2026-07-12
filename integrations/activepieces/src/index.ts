import { createPiece } from '@activepieces/pieces-framework';

import { createPost } from './actions/create-post';
import { validatePost } from './actions/validate-post';
import { simplePostAuth } from './lib/auth';

export const simplepost = createPiece({
  displayName: 'SimplePost',
  description: 'Publish and schedule social media posts with SimplePost.',
  minimumSupportedRelease: '0.82.0',
  logoUrl: 'https://app.simplepost.social/favicon-32x32.png',
  authors: ['simple-post'],
  auth: simplePostAuth,
  actions: [createPost, validatePost],
  triggers: [],
});
