import FormData from "form-data";
import { getFileStreamAndMetadata } from "@pipedream/platform";
import simplepost from "../../simplepost.app.mjs";

export default {
  key: "simplepost-upload-media",
  name: "Upload Media",
  description: "Upload an image or video (JPEG, PNG, GIF, WebP, MP4, MOV, or WebM, up to 500 MiB) to SimplePost storage for use in a post. [See the documentation](https://docs.simplepost.social/media-storage)",
  version: "0.0.1",
  type: "action",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  props: {
    simplepost,
    file: {
      type: "string",
      label: "File Path or URL",
      description: "The file to upload. Provide a URL or a path in `/tmp`, e.g. `/tmp/photo.jpg` or `https://example.com/clip.mp4`.",
      format: "file-ref",
    },
    syncDir: {
      type: "dir",
      accessMode: "read",
      sync: true,
      optional: true,
    },
  },
  async run({ $ }) {
    const {
      stream, metadata,
    } = await getFileStreamAndMetadata(this.file);
    const form = new FormData();
    form.append("file", stream, {
      filename: metadata.name,
      contentType: metadata.contentType,
      knownLength: metadata.size,
    });

    const upload = await this.simplepost.uploadMedia({
      $,
      data: form,
      headers: form.getHeaders(),
    });

    const media = {
      id: upload.key,
      url: upload.url,
      type: upload.type.startsWith("video/")
        ? "video"
        : "image",
      contentType: upload.type,
      filename: upload.filename,
      size: upload.size,
    };
    $.export("$summary", `Uploaded ${media.filename} (${media.size} bytes)`);
    return {
      ...upload,
      media,
    };
  },
};
