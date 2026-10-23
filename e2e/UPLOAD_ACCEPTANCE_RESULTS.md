# Upload acceptance results

Status on 2026-10-23: **17 cases automatically verified in production; the two
remaining TikTok checks were waived by the owner.** TikTok is accepted by the
owner, with no claim that its remaining automation passed. The owner confirmed
the photo is visible and supplied its link; its video case was not submitted.

## Release

- Aggregate PR: [#173](https://github.com/simple-post/core/pull/173), merged into
  `main` as `e74fa2565af6ac036d96e09b5e2c2b89e508d377`.
- Production promotion: [#174](https://github.com/simple-post/core/pull/174), merged
  into `release/prod` as `af095bd981d5557757b08fbb5dafb8f1dfd71702`.
- Coolify reported successful production deployment. The running container uses
  that revision, and the public app returned HTTP 200.
- Main and production file trees match. No new migrations were added.
- Rollback anchor: `24feabbbf9b802bb4cd73d5c1393ca361f6980d0`.

The owner explicitly changed the plan to production testing. No temporary dev
source-branch change or rollback was performed. Subsequent corrections concern
the local E2E harness; deployed SDK logic did not change during this run.

## Live results

Run ID: `uploads-acceptance-20261023`, using the customer UI and the existing
Edmund test-account configuration. Generated originals:

- JPEG: 1,961,069 bytes, 1080×1080.
- MP4: 31,130,349 bytes, 720×1280, 30 seconds, H.264/AAC.

| Platform  | Image                                         | Large video                 |
| --------- | --------------------------------------------- | --------------------------- |
| Bluesky   | Verified                                      | Verified                    |
| Facebook  | Verified                                      | Verified                    |
| Instagram | Verified                                      | Verified                    |
| LinkedIn  | Verified                                      | Verified                    |
| Pinterest | Verified                                      | Verified                    |
| Telegram  | Verified                                      | Verified                    |
| Threads   | Verified                                      | Verified                    |
| X         | Verified                                      | Verified                    |
| YouTube   | Outside this profile                          | Verified private upload     |
| TikTok    | Owner accepted; automated verification waived | Owner waived; not submitted |

Seventeen cases have complete saved-post, publishing-record and platform-content
proof. Eighteen cases have publication receipts, including TikTok's photo handle.
Accepted posts were never replaced to retry verification. The same journals and
receipts were retained across resumes.

YouTube owner readback verified the exact channel, title, description, private
visibility, original 31,130,349-byte source, one 720×1280 stream, successful
processing and processed duration `PT31S`. Google omitted source duration.
After the owner completed Google's human check, the same signed-out guest window
passed the standard private-video-page checks. Saved evidence includes the native
private-video notice and independent owner metadata.

YouTube also reported failure to apply the generated custom thumbnail. The SDK
returned the existing video ID with a warning and did not upload another video.
Thumbnail capability is outside this profile; no thumbnail success is claimed.

X was reconnected by the owner. Its image and large video both passed in installed
Chrome after repairing the observer for X's current guest-page markup.

TikTok's photo was accepted by its API without a public post ID. The owner
confirmed the marked photo is visible and supplied its share link, which resolved
to the exact photo permalink. A fresh guest session required another slider
challenge. The owner then explicitly accepted TikTok and waived the remaining
checks. Its automated journal was not changed to claim verification. No TikTok
video was submitted after that waiver. The ignored run artifacts retain the
owner's waiver separately from automated evidence.

## Harness corrections and validation

Working with Claude Code CLI using `claude-fable-5-1`, we corrected:

- Explicit YouTube Private selection needed a change away and back to persist
  the request option. The guard caught its omission before submission and remains.
- Telegram changed its caption wrapper. Exact text, bot, direction and time
  checks remain intact.
- Pinterest changed its closeup, description and image selectors. Author and
  media checks remain confined to the actual pin. Video processing needed about
  two minutes before content verification passed.
- X changed its guest post and media markup. Exact permalink, account, caption
  and image/video checks remain intact; recommendations and avatars are excluded.
- An optional browser channel permits installed Chrome, which rendered the X
  page where bundled Chromium returned a blank page. Configuration snapshots
  preserve the choice; run metadata records it, and new observer evidence can
  record the actual browser version.
- TikTok upload acceptance covers media and audience without demanding a separate
  music-setting observer. Explicit music and existing music regressions remain.
- An unresolved TikTok handle now stops before opening an uncalibrated profile,
  instead of repeatedly reloading with detail-page selectors. A canonical post
  URL or calibrated observer is required; the accepted receipt is retained.
- Omitted YouTube source duration is omitted from evidence. Supplied source
  duration remains strictly checked. Processed duration, exact source bytes,
  dimensions, processing status, ownership, text and privacy remain required.
- Google's explicit unusual-traffic URL is classified as a setup block.

Validation:

- Aggregate PR GitHub CI passed before the main merge.
- SDK: **916 tests passed** across 42 suites; SDK/CLI builds passed.
- Full offline E2E suite after the X corrections: **688 checks passed**, including
  all 19 upload contracts with the larger originals present.
- Later TikTok fail-closed handling and X regression refinements passed focused
  checks; TypeScript and formatting checks passed.

These live success-path checks do not establish recovery during an actual
provider outage. Retry and ambiguous-outcome behavior have automated SDK coverage;
no provider outage was injected into production.

## Evidence and any future continuation

The ignored local run contains journals, receipts, platform screenshots, observer
metadata, publishing records and the owner's TikTok waiver. App authentication was
refreshed through normal manual sign-in, and the user plus all ten social
identities were checked before posting. Secrets and session files remain ignored.

If TikTok automation is revisited, retain the original receipt and run ID, remove
only the explicitly superseded waiver, and verify the existing photo. Its video
remains the only unsubmitted case. The configured cap remains 19 posts, two per
platform except one for YouTube, with a pause after the first platform failure.
