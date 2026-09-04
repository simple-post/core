# TikTok Publisher

Post one video or an ordered carousel of 1–35 photos through TikTok's Content Posting API. The same TikTok options work in the SDK, CLI, HTTP API, MCP and scheduler UI.

## Publishing modes

| `publishMode`      | TikTok behavior                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `public` (default) | Direct Post. The selected `privacyLevel` controls the audience; the mode name does not force public visibility.          |
| `draft`            | Upload to the TikTok inbox without publishing. Open TikTok's inbox notification to add music, edit and publish manually. |

The scheduler/MCP top-level `postingMode: "draft"` saves a **SimplePost draft without uploading anything**. To upload to TikTok now, use `postingMode: "now"` and `accountOptions[accountId].publishMode: "draft"`. A scheduled post can also upload to the TikTok inbox at its scheduled time.

## Photo requirements

- 1–35 JPEG or WebP photos, in attachment order. Do not mix photos and videos.
- Maximum 20 MB per image and 1080p, per TikTok's media transfer requirements. TikTok performs final media processing/format validation.
- Photo URLs must be public HTTPS URLs without redirects, on a domain or URL prefix **verified for your TikTok developer app**. Arbitrary external image URLs cannot be used directly unless verified; upload them to your verified storage first.
- Local SDK/CLI photos use the existing S3-compatible uploader. Configure `S3_STORAGE_ACCESS_KEY_ID`, `S3_STORAGE_SECRET_ACCESS_KEY`, `S3_STORAGE_REGION`, `S3_STORAGE_BUCKET`, `S3_STORAGE_BASE_URL`, and optionally `S3_STORAGE_ENDPOINT`. Verify the public base URL's domain/prefix with TikTok.
- The app-connected CLI and UI upload local files through SimplePost's media storage.
- URLs must stay available until TikTok finishes downloading them (up to one hour). The SDK removes its staged files after a terminal TikTok status; on a timeout/ambiguous response it retains them. Configure storage lifecycle cleanup for retained `tiktok_` files, allowing at least one hour for downloads.
- Photo `title`: up to 90 UTF-16 code units. Photo `description`: up to 4000; defaults to `content.text` (SDK) or `message` (MCP/HTTP/UI).

## TikTok options

| Option                                        | Type                                                                              | Default / behavior                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `publishMode`                                 | `"public" \| "draft"`                                                             | Direct Post / TikTok inbox upload                                                               |
| `title`                                       | `string`                                                                          | Photo title: first image caption or empty. Video caption: video title/description or post text. |
| `description`                                 | `string`                                                                          | Photos only; overrides the post text                                                            |
| `autoAddMusic`                                | `boolean`                                                                         | `false`; `true` adds TikTok-recommended music to photo Direct Posts only                        |
| `photoCoverIndex`                             | `number`                                                                          | `0`; zero-based index within the attached photos                                                |
| `privacyLevel`                                | `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` | Required for Direct Post; must be available in creator info                                     |
| `visibility`                                  | `"public" \| "friends" \| "private"`                                              | Legacy privacy alias                                                                            |
| `allowComment`                                | `boolean`                                                                         | `false`; Direct Post only                                                                       |
| `allowDuet`, `allowStitch`                    | `boolean`                                                                         | `false`; video Direct Post only                                                                 |
| `commercialContentDisclosure`                 | `boolean`                                                                         | Enables commercial disclosure controls                                                          |
| `discloseYourBrand`, `discloseBrandedContent` | `boolean`                                                                         | Mark creator-owned promotion / third-party branded content                                      |

Set `autoAddMusic` to false or omit it for inbox uploads and videos. The API does not expose a song picker or custom audio attachment for photos. Use inbox upload to choose music manually in TikTok.

## SDK example

```typescript
import { post } from "@simple-post/sdk";

await post({
  content: {
    text: "A week of building SimplePost",
    media: [
      { type: "image", url: "https://your-verified-cdn.example/1.jpg" },
      { type: "image", url: "https://your-verified-cdn.example/2.webp" },
      { type: "image", url: "https://your-verified-cdn.example/3.jpg" },
      { type: "image", url: "https://your-verified-cdn.example/4.jpg" },
    ],
  },
  platforms: ["tiktok"],
  options: {
    tiktok: {
      credentials: { accessToken: process.env.TIKTOK_ACCESS_TOKEN! },
      publishMode: "public",
      privacyLevel: "SELF_ONLY", // Use the creator's chosen, available audience.
      title: "This week",
      autoAddMusic: true,
      photoCoverIndex: 0,
    },
  },
});
```

For manual music selection, change the options to `publishMode: "draft"` and remove `autoAddMusic`. Privacy is chosen later in TikTok. Both modes return the real `publish_id` for tracking. Inbox upload success is not public publication; read the result message and `extraData.platformData.status`. Processing failures return an error. If processing is still pending, keep the returned ID and avoid blindly resubmitting a duplicate.

## HTTP / MCP

```json
{
  "message": "A photo story",
  "accountIds": ["TIKTOK_ACCOUNT_ID"],
  "postingMode": "now",
  "accountOptions": {
    "TIKTOK_ACCOUNT_ID": {
      "publishMode": "draft",
      "title": "My story",
      "autoAddMusic": false
    }
  },
  "media": [
    { "type": "image", "url": "https://your-verified-cdn.example/1.jpg" },
    { "type": "image", "url": "https://your-verified-cdn.example/2.jpg" }
  ]
}
```

This is MCP `create_post` input. For HTTP, supply the regular media metadata (`id`, `filename`, `size`) as described in the HTTP API docs. MCP applies its existing default public privacy for Direct Post only; inbox uploads bypass it.

## CLI

```bash
simplepost post --account tiktok:main \
  --image ./1.jpg --image ./2.jpg --image ./3.webp --image ./4.jpg \
  --text "A photo story" --tiktok-title "My story" \
  --tiktok-publish-mode public --tiktok-privacy-level SELF_ONLY \
  --tiktok-auto-add-music --tiktok-photo-cover-index 0

simplepost post --app-account-id TIKTOK_ACCOUNT_ID \
  --image ./1.jpg --image ./2.jpg \
  --text "Choose music in TikTok" --tiktok-publish-mode draft
```

Use `--no-tiktok-auto-add-music` to explicitly disable automatic music. Interactive posting offers both publishing modes and the photo music option. Full `--post-json` and `--options-json` support the same SDK fields.

## Permissions and references

The existing `video.publish` scope covers photo Direct Post; `video.upload` covers inbox upload. No new scope is needed. Direct Post queries creator info and respects audience and interaction restrictions. Unaudited apps remain subject to TikTok's private-post restrictions.

- [Photo API](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post)
- [Media transfer requirements](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
- [Direct Post setup](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
