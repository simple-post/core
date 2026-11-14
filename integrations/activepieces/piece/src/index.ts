import { createPiece, PieceCategory } from '@activepieces/pieces-framework';
import { createCustomApiCallAction } from '@activepieces/pieces-common';

import { createPost } from './lib/actions/create-post';
import { getPost } from './lib/actions/get-post';
import { listAccounts } from './lib/actions/list-accounts';
import { uploadMedia } from './lib/actions/upload-media';
import { validatePost } from './lib/actions/validate-post';
import { simplepostAuth } from './lib/auth';
import { getBaseUrl, getCredentials } from './lib/common/client';
import { postFailed } from './lib/triggers/post-failed';
import { postPublished } from './lib/triggers/post-published';

export const simplepost = createPiece({
  displayName: 'SimplePost',
  description:
    'Publish and schedule posts to X, LinkedIn, Instagram, Facebook, Threads, Bluesky, TikTok, YouTube, Pinterest, and more from one place.',
  auth: simplepostAuth,
  minimumSupportedRelease: '0.82.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/simplepost.png',
  categories: [PieceCategory.MARKETING],
  authors: ['haltakov'],
  actions: [
    createPost,
    validatePost,
    uploadMedia,
    getPost,
    listAccounts,
    createCustomApiCallAction({
      auth: simplepostAuth,
      baseUrl: (auth) => (auth ? `${getBaseUrl(auth)}/api/v1` : ''),
      authMapping: async (auth) => ({
        Authorization: `Bearer ${getCredentials(auth).api_key}`,
      }),
    }),
  ],
  triggers: [postPublished, postFailed],
});
