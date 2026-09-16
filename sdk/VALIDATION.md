# Publishing validation

Validation runs before media uploads or publish requests. All built-in publishers,
`post`/`quote`, SDK/CLI callers, the scheduler HTTP API, MCP, and the standalone
server use the same rules. Client-side checks provide immediate feedback;
server-side checks measure the source again before saving or sending.

## Layers

1. `validation.ts` and `validation/final-options.ts` are browser-safe pure rules.
   They validate the final title, description, text and account options with the
   same precedence as publishing. Extra attachments and oversized derived titles
   produce errors instead of being discarded or truncated. TikTok's generated
   photo heading remains an excerpt: its complete text is retained in description.
2. `media-inspection.ts` measures files, checks public URL access using the shared
   SSRF protections, verifies MIME against bytes, decodes images and probes videos.
   Request-local caches reuse measurements across destinations; no authorization
   decisions are cached. TikTok photo URLs are inspected without redirects.
3. `validation/media-rules.ts` applies endpoint-specific measured-media rules.
   Caller size, MIME and duration fields are hints only and are overwritten.
4. `Publisher.validateReadiness` performs read-only account checks. The scheduler
   refreshes credentials under its existing account lock. Publisher dispatch
   rechecks live eligibility; it never creates a test post or uploads media to
   discover permissions.
5. Issues carry a stable code, severity, field, actual/limit where applicable,
   and account ID. MCP retains those fields. Warnings never invalidate a post.
   Failed optional account reads return `account_readiness_unverified`; an
   explicit denial, expired connection, exhausted quota or known content violation
   blocks publishing.

## Coverage and sources (reviewed 2026-09-08)

All platforms retain text, attachment-count, mixed-media, actual file-size and
image-format checks. The additional checks and their boundaries are:

| Platform  | Additional checks                                                                                                                                                                                                                | Remaining provider-side conditions                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram | JPEG dimensions and 4:5–1.91:1 image ratio; Reels vs carousel video duration; container, codec, frame rate, bitrate and Reels width; live account publishing quota                                                               | Moderation, expired containers, quota changes after validation; 9:16 and 48 kHz guidance is advisory                                                                                                      |
| TikTok    | Actual video duration, codecs, dimensions and frame rate; photo dimensions; final caption/title and cover index; direct HTTPS photo access; creator privacy, interaction settings and duration entitlement                       | Developer-app URL-domain ownership has no read API; draft inbox and anti-spam caps can still change                                                                                                       |
| Bluesky   | 300 graphemes and 3,000 UTF-8 bytes; actual MP4 container and ten-minute duration; verified-email/video service quota before upload                                                                                              | Moderation and rate-limit changes after validation                                                                                                                                                        |
| Telegram  | Image dimension sum/ratio; MP4 video; HTML/Markdown/MarkdownV2 formatting validity and decoded length; bot/channel/group media permissions                                                                                       | Custom emoji access, inaccessible reply targets and private-chat blocks may be provider-side                                                                                                              |
| YouTube   | Final title and UTF-8 description; invalid characters; aggregate tag length; native schedule time; assignable category; channel presence and long-upload access; actual video duration; custom-thumbnail bytes and accessibility | Custom-thumbnail feature eligibility, strikes, daily upload capacity and processing acceptance are not fully exposed                                                                                      |
| X         | Actual GIF type, animation dimensions/frame count/total pixels and one-GIF-only rule; video codec, audio profile, pixel format, sample aspect, frame rate and duration; live Premium entitlement                                 | Dynamic anti-spam and access restrictions; existing 512 MiB video ceiling is an implementation limit                                                                                                      |
| LinkedIn  | Image pixels and animation frame count; explicit error for attachments on quotes; actual encoding inspection                                                                                                                     | The publisher uses the existing Assets upload path. Its 200 MiB video ceiling is retained; ad/other endpoint video limits are not applied to it. Member posting restrictions lack reliable preflight APIs |
| Threads   | Every root/override/thread attachment; measured video duration/encoding/frame rate/bitrate; live quota and reply-target read check                                                                                               | Extreme image ratios are advisory; reply permissions and moderation may change                                                                                                                            |
| Facebook  | Final video description; native schedule syntax/minimum delay; measured video encoding; Page task access when returned                                                                                                           | Organic Page video is distinct from Reels and ads. Conflicting native schedule upper windows produce a warning after 30 days                                                                              |
| Pinterest | Final title/description/alt/link lengths; numeric board; board accessibility; video encoding/duration and supplied cover image                                                                                                   | Board visibility does not prove collaborator write access; that uncertainty is returned explicitly. Recommended 2:3 images stay advisory                                                                  |
| Forem     | Final serialized Markdown, title, tag syntax/count; front matter cannot override validated options; recent duplicate-title warning                                                                                               | Organization/series membership and instance-specific policies are explicitly unverified                                                                                                                   |

Primary references:

- [Meta Instagram API](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)
- [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Threads API](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Facebook Page posts](https://developers.facebook.com/docs/pages-api/posts/)
- [TikTok media transfer](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
- [TikTok creator info](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info)
- [Bluesky lexicons](https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [YouTube video resource](https://developers.google.com/youtube/v3/docs/videos)
- [X media requirements](https://docs.x.com/x-api/media/quickstart/best-practices)
- [LinkedIn images](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [Pinterest API schema](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml)
- [Forem article model](https://github.com/forem/forem/blob/main/app/models/article.rb)
- [Forem tag model](https://github.com/forem/forem/blob/main/app/models/tag.rb)

## Runtime and practical limits

Video validation requires `ffprobe` on PATH (or an absolute `FFPROBE_PATH`). Install
FFmpeg with your operating system's package manager. Both server Dockerfiles and
CI install the OS-maintained package; the scheduler's distroless runtime includes
the binary and its linked libraries. Missing or failed probes produce an error,
never a successful validation. ffprobe runs against local files only, with a
protocol/container allowlist, a minimal environment, a 30-second timeout and a
1 MiB metadata-output limit. It cannot fetch network resources or inherit tokens.

Remote video inspection downloads to a temporary file through the existing
500 MiB download limit, then removes it even on failure. This is a SimplePost
resource ceiling, independent of higher native platform limits. Images are
bounded to 32 MiB and 40 million decoded pixels. Complete decoding/inspection and
at most three concurrent remote inspections bound resource use. Video probing
checks streams and metadata; it does not decode every frame or guarantee that a
provider's transcoder accepts the whole file. Unknown metadata blocks sending.

Content can change at a remote URL and account state can change after validation.
The publishing boundary re-inspects/rechecks, but no preflight can guarantee
provider acceptance, prevent moderation, or reserve future quota. Existing failed
post accounting and durable-publish protections remain in force.

## Optional image fitting

Validation remains blocking by default. Callers may opt in to `imageFit: "crop" | "blur"` to prepare compatible images and validate again. See [image fitting](../docs/image-fitting.md) for API, MCP, CLI, SDK and UI behavior and processing limits.
