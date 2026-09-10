# Fit images before publishing

SimplePost can fix incompatible image formats, dimensions, aspect ratios and file sizes. Fitting is opt-in; normal validation remains unchanged when it is omitted.

- `crop`: centre-crop to the nearest allowed aspect ratio, trimming edges.
- `blur`: preserve the complete image over a blurred, enlarged copy of itself when padding is needed.

Both methods convert incompatible images to JPEG, respect EXIF rotation, resize to platform dimension limits and reduce quality/file dimensions until the file meets the strictest applicable byte limit. Compatible images retain their original URL/file and format. Source files are never overwritten. Images requiring conversion become still JPEGs, including animated GIF/WebP; transparency is composited onto white.

Shared images fit the intersection of the selected accounts that use them. Account-specific images fit that account. Thread media and YouTube/Pinterest cover images are included. Fitting does not remove attachments, fix mixed-media restrictions, create missing media or bypass account permissions. The regular validators run again on the result.

## API

The hosted scheduler and self-hosted server accept optional `imageFit: "crop" | "blur"` on `POST /api/v1/posts` and `POST /api/v1/validation`. Scheduler post updates accept it too. Omit `imageFit` to disable transformations.

```json
{
  "message": "A tall photo",
  "accountIds": ["instagram-account", "bluesky-account"],
  "postingMode": "now",
  "imageFit": "blur",
  "media": [{
    "id": "photo-1",
    "type": "image",
    "url": "https://example.com/tall-photo.png",
    "filename": "tall-photo.png",
    "size": 0
  }]
}
```

For review before publishing, submit the content to `/api/v1/validation` with `imageFit`. The response includes the normal validation result and `fittedContent` containing `media`, `accountOverrides`, `accountOptions`, and `thread`. Render those image URLs, then copy the reviewed fields into the create/update request **without** `imageFit`. Validation may still return unrelated errors; resolve them before publishing. Validation with fitting uploads derivatives but never publishes a post.

Transformations require configured S3-compatible storage for hosted URLs. Scheduler derivatives are registered with the existing 24-hour storage collection process: media referenced by saved posts is retained; abandoned previews are eligible for collection. Save reviewed images before they expire. The self-hosted server uses its configured bucket and requires an operator-managed retention policy for unused previews.

## MCP

`create_post`, `preview_post`, `validate_post`, and `update_scheduled_post` accept `imageFit`. Fitting requires the existing `posts:write` scope because it uploads derivative media, including during validation/preview.

When validation finds a fixable image issue, SimplePost provides instructions to offer the two methods. After the user chooses, retry with the chosen method. If the user already asked to fit images, no extra fitting confirmation is needed; use their chosen method, defaulting to `blur` if they did not specify one. Other posting authorization still applies.

`validate_post` returns `fittedMedia`, `fittedThread`, and `fittedAccountOptions` when fitting is requested. Reuse them for a visual preview or subsequent create request. To compare methods, submit the original source URLs again, not an already-cropped derivative.

## CLI

```bash
simplepost post --account instagram:main --account bluesky:main \
  --text "A tall photo" --image ./photo.png --fit-images blur

simplepost post --app-account-id ACCOUNT_ID \
  --text "A tall photo" --image ./photo.png --fit-images crop
```

When an image validation issue is found in a terminal, the CLI offers blurred padding, cropping, or cancellation before publishing to any target. An explicit `--fit-images` skips that prompt. Without a terminal, an incompatible image produces an actionable error asking for an explicit flag; it never waits on stdin. Original files are retained and temporary fitted files are cleaned up after publication, including failures.

## TypeScript SDK

```ts
import { post, fitPostImages } from "@simple-post/sdk";

await post({
  platforms: ["instagram", "bluesky"],
  content: { text: "A tall photo", media: [{ type: "image", path: "./photo.png" }] },
  imageFit: "blur",
});

// For explicit preparation/review:
const fitted = await fitPostImages({
  platforms: ["instagram"],
  content: { media: [{ type: "image", path: "./photo.png" }] },
}, "crop");
try {
  // Review fitted.post.content.media before publishing.
  await post(fitted.post);
} finally {
  await fitted.cleanup();
}
```

The low-level `fitImage` helper returns JPEG bytes and dimensions only when an image needs changing, otherwise `undefined`. It also indicates whether an animation became a still image.

## Web app

Image validation errors display **Fit images…**. Choose a method, generate a preview, compare originals with fitted images, switch methods, or swap an image. **Use these images** applies the reviewed result to the draft; **Cancel** leaves the draft unchanged. Further validation still blocks unresolved issues. Changing methods always starts from the original images within the review dialog.

## Processing limits

Fitting currently accepts decodable JPEG, PNG, GIF and WebP inputs up to 32 MiB and 40 million pixels, matching the existing inspection budget. Corrupt images, private URLs, and larger inputs require a replacement or an external export first. Downloads retain the shared SSRF/DNS/redirect protections. JPEG quality starts at 90, can fall to 60, and dimensions are reduced if that is insufficient. No generative editing is used.


## Private hosted rollout

Hosted image fitting is disabled by default. Apply the Prisma migration before
deploying the scheduler. No users are granted access by the migration.
The server checks `hasFeature(userId, Feature.IMAGE_FITTING)` before any fitting
downloads or uploads. UI controls and MCP fitting parameters/instructions are
only exposed to granted users. Explicit API fitting requests without a grant
receive HTTP 403. Ordinary image validation remains available.

Grant access using trusted administrative code with the generated Prisma enum:

```ts
import { Feature } from "@prisma/client";

await prisma.userFeature.upsert({
  where: { userId_feature: { userId, feature: Feature.IMAGE_FITTING } },
  create: { userId, feature: Feature.IMAGE_FITTING },
  update: {},
});
```

Revoke access:

```ts
await prisma.userFeature.deleteMany({
  where: { userId, feature: Feature.IMAGE_FITTING },
});
```

Rows are stored in `user_feature`, uniquely keyed by user ID and feature.
Deleting a user removes their grants. Checks are not cached on the server, so
revocation blocks the next fitting request. Existing fitted images are retained.
`GET /api/v1/features` returns the authenticated user's grants; there is no public
grant-management endpoint. Grants are separate from subscription access.

Local SDK/CLI fitting and the self-hosted API do not use the hosted user database.
Keep the SDK/CLI release unpublished during the private hosted rollout.
