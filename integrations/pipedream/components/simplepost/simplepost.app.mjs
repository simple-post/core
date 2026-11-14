import { axios } from "@pipedream/platform";
import constants from "./common/constants.mjs";
import utils from "./common/utils.mjs";

export default {
  type: "app",
  app: "simplepost",
  propDefinitions: {
    accountIds: {
      type: "string[]",
      label: "Account IDs",
      description: "The connected social accounts to post to, e.g. `[\"cm8x1k2ab0001\"]`. Use **List Accounts** to find account IDs (the `id` field).",
      async options() {
        const { accounts } = await this.listAccounts();
        return accounts
          .filter((account) => !account.previewOnly)
          .map((account) => ({
            label: utils.accountLabel(account),
            value: account.id,
          }));
      },
    },
    postId: {
      type: "string",
      label: "Post ID",
      description: "The SimplePost post ID, e.g. `cm8x1k2ab0002`. Returned by **Create Post** (the `post.id` field).",
      async options({ page }) {
        const pages = await Promise.all(constants.POST_LIST_TYPES.map((type) => this.listPosts({
          params: {
            type,
            page: page + 1,
            limit: 25,
          },
        })));
        return pages.flatMap(({ posts = [] }) => posts).map((post) => ({
          label: `${post.message?.slice(0, 60) || "(no text)"} - ${post.status}`,
          value: post.id,
        }));
      },
    },
    message: {
      type: "string",
      label: "Message",
      description: "The post text, e.g. `Our spring collection is live!`. Leave empty only for media-only posts.",
      optional: true,
    },
    mediaUrls: {
      type: "string[]",
      label: "Media URLs",
      description: "Public image or video URLs to attach, e.g. `[\"https://example.com/photo.jpg\"]`. The file type is read from the extension (.jpg, .jpeg, .png, .gif, .webp, .mp4, .m4v, .mov, .webm). SimplePost imports each file when the post is saved. Use **Upload Media** for files in `/tmp` or URLs without an extension.",
      optional: true,
    },
    media: {
      type: "string",
      label: "Media (JSON)",
      description: "Media uploaded with **Upload Media**: its `media` output, or a JSON array of such objects, appended after **Media URLs**, e.g. `[{\"id\":\"1\",\"url\":\"https://example.com/clip.mp4\",\"type\":\"video\",\"filename\":\"clip.mp4\",\"size\":0}]`.",
      optional: true,
    },
    thread: {
      type: "string",
      label: "Thread (JSON)",
      description: "A JSON array of up to 24 follow-up segments for platforms that support threads (X, Bluesky, Threads, Telegram), e.g. `[{\"message\":\"Part 2\"},{\"message\":\"Part 3\"}]`.",
      optional: true,
    },
    accountOptions: {
      type: "string",
      label: "Account Options (JSON)",
      description: "Platform settings keyed by account ID, e.g. `{\"cm8x1k2ab0001\":{\"privacyStatus\":\"unlisted\",\"title\":\"Launch video\"}}` for YouTube or `{\"cm8x1k2ab0003\":{\"boardId\":\"123\"}}` for Pinterest. See the [posting model](https://docs.simplepost.social/posting-model) for each platform's options.",
      optional: true,
    },
    accountOverrides: {
      type: "string",
      label: "Account Overrides (JSON)",
      description: "Per-account content keyed by account ID, replacing the shared `message`, `media`, or `thread` for that account, e.g. `{\"cm8x1k2ab0001\":{\"message\":\"Shorter text for X\"}}`.",
      optional: true,
    },
    imageFit: {
      type: "string",
      label: "Image Fit",
      description: "Fit images that a platform would reject (aspect ratio, size, or format) instead of failing, e.g. `blur`. `blur` keeps the whole image over a blurred background; `crop` trims the edges. Leave empty to keep the original images. Requires image fitting to be enabled for your SimplePost account; otherwise the request fails with `403`.",
      options: constants.IMAGE_FIT_OPTIONS,
      optional: true,
    },
  },
  methods: {
    _baseUrl() {
      return (this.$auth.base_url || constants.DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    },
    /**
     * Sends an authenticated request to the SimplePost Scheduler API.
     * @param {object} opts - axios options plus the step context `$`
     * @returns {Promise<object>} The parsed response body
     */
    _makeRequest({
      $ = this, headers, ...opts
    }) {
      return axios($, {
        baseURL: this._baseUrl(),
        headers: {
          Authorization: `Bearer ${this.$auth.api_key}`,
          ...headers,
        },
        ...opts,
      });
    },
    /**
     * Lists the connected social accounts.
     * @param {object} opts - Request options
     * @returns {Promise<{accounts: object[]}>}
     */
    listAccounts(opts = {}) {
      return this._makeRequest({
        url: "/api/v1/accounts",
        ...opts,
      });
    },
    /**
     * Lists posts of one type (`scheduled`, `drafts`, `past`, or `failed`).
     * @param {object} opts - Request options with `params.type`, `params.page`, `params.limit`
     * @returns {Promise<{posts: object[], pagination: object}>}
     */
    listPosts(opts = {}) {
      return this._makeRequest({
        url: "/api/v1/posts",
        ...opts,
      });
    },
    /**
     * Gets one post with its per-account results.
     * @param {object} opts - Request options with `postId`
     * @returns {Promise<{post: object}>}
     */
    getPost({
      postId, ...opts
    }) {
      return this._makeRequest({
        url: `/api/v1/posts/${encodeURIComponent(postId)}`,
        ...opts,
      });
    },
    /**
     * Creates a post that is published now, scheduled, or saved as a draft.
     * @param {object} opts - Request options with the post in `data`
     * @returns {Promise<object>} `{ post, postingResults?, summary?, warnings?, replayed? }`
     */
    createPost(opts = {}) {
      return this._makeRequest({
        method: "POST",
        url: "/api/v1/posts",
        ...opts,
      });
    },
    /**
     * Validates a post against the selected accounts without saving it.
     * @param {object} opts - Request options with the post in `data`
     * @returns {Promise<{summary: {isValid: boolean, errors: object[], warnings: object[]}}>}
     */
    validatePost(opts = {}) {
      return this._makeRequest({
        method: "POST",
        url: "/api/v1/validation",
        ...opts,
      });
    },
    /**
     * Uploads one file as multipart form data (field `file`).
     * @param {object} opts - Request options with a `form-data` body in `data`
     * @returns {Promise<{url: string, key: string, filename: string, size: number, type: string}>}
     */
    uploadMedia(opts = {}) {
      return this._makeRequest({
        method: "POST",
        url: "/api/v1/upload",
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        ...opts,
      });
    },
    /**
     * Registers a webhook endpoint. The signing secret is only returned here.
     * @param {object} opts - Request options with `{url, events}` in `data`
     * @returns {Promise<{webhook: {id: string, secret: string}}>}
     */
    createWebhook(opts = {}) {
      return this._makeRequest({
        method: "POST",
        url: "/api/v1/webhooks",
        ...opts,
      });
    },
    /**
     * Deletes a webhook endpoint.
     * @param {object} opts - Request options with `webhookId`
     * @returns {Promise<{success: boolean}>}
     */
    deleteWebhook({
      webhookId, ...opts
    }) {
      return this._makeRequest({
        method: "DELETE",
        url: `/api/v1/webhooks/${encodeURIComponent(webhookId)}`,
        ...opts,
      });
    },
  },
};
