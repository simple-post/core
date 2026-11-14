import { createAction, Property } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { simplepostAuth } from '../auth';
import { simplepostRequest } from '../common/client';
import { mediaTypeFromContentType, mediaTypeFromFilename } from '../common/media';

type UploadResponse = {
  filename: string;
  key: string;
  size: number;
  type: string;
  url: string;
};

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export const uploadMedia = createAction({
  auth: simplepostAuth,
  name: 'upload_media',
  classification: 'WRITE',
  displayName: 'Upload Media',
  description: 'Upload an image or video file to SimplePost for use in a post.',
  audience: 'both',
  aiMetadata: {
    description:
      'Upload a file produced by an earlier step (JPEG, PNG, GIF, WebP, MP4, MOV, or WebM) to SimplePost storage and return its URL and media type. Use it when the file is not already at a public URL; public URLs can go straight into Create Post. Each call stores a new copy.',
    idempotent: false,
  },
  props: {
    file: Property.File({
      displayName: 'File',
      description: 'The image or video to upload, usually from an earlier step.',
      required: true,
    }),
    filename: Property.ShortText({
      displayName: 'File Name',
      description: 'Optional name to store the file under, including the extension, e.g. `launch.mp4`.',
      required: false,
    }),
  },
  outputSchema: {
    fields: [
      { key: 'url', label: 'Media URL', format: 'url' },
      { key: 'type', label: 'Type' },
      { key: 'filename', label: 'File Name' },
      { key: 'content_type', label: 'Content Type' },
      { key: 'size', label: 'Size', format: 'filesize' },
    ],
  },
  async run(context) {
    const { file } = context.propsValue;
    const filename = context.propsValue.filename?.trim() || file.filename || 'upload';
    const extension = (file.extension || filename.split('.').pop() || '').toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) {
      throw new Error(
        `Unsupported file type "${extension || 'unknown'}". Upload a JPEG, PNG, GIF, WebP, MP4, MOV, or WebM file.`,
      );
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.data)], { type: contentType }), filename);

    const uploaded = await simplepostRequest<UploadResponse>({
      auth: context.auth,
      method: HttpMethod.POST,
      path: '/api/v1/upload',
      body: form,
    });

    return {
      url: uploaded.url,
      type: mediaTypeFromContentType(uploaded.type) ?? mediaTypeFromFilename(uploaded.filename) ?? null,
      filename: uploaded.filename,
      content_type: uploaded.type,
      size: uploaded.size,
    };
  },
});
