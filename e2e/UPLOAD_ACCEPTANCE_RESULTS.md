# Upload acceptance results

Status on 2026-10-23: **14 of 19 cases fully verified in production**. Seven
platforms passed both image and large-video uploads. Five cases remain blocked
or unrun because of account reconnection or human verification requirements.
This is not a complete acceptance pass.

## Release

- Aggregate PR: [#173](https://github.com/simple-post/core/pull/173), merged into
  `main` as `e74fa2565af6ac036d96e09b5e2c2b89e508d377`.
- Production promotion: [#174](https://github.com/simple-post/core/pull/174), merged
  into `release/prod` as `af095bd981d5557757b08fbb5dafb8f1dfd71702`.
- Coolify reported a successful production deployment. The running production
  container uses that release revision and the public app returned HTTP 200.
- The main and production release file trees match. No new migrations were added.
- Previous production revision, retained as the rollback anchor:
  `24feabbbf9b802bb4cd73d5c1393ca361f6980d0`.

The owner explicitly changed the plan to production testing after deployment.
No temporary change to the dev deployment's source branch was made. No rollback
has been performed. Subsequent fixes concern the local E2E harness; deployed SDK
logic has not changed during the live run.

## Live results

Run ID: `uploads-acceptance-20261023`, through the customer UI and the existing
Edmund test-account configuration. Original fixtures:

- JPEG: 1,961,069 bytes, 1080×1080.
- MP4: 31,130,349 bytes, 720×1280, 30 seconds, H.264/AAC.

| Platform  | Image                                                           | Large video                                                       |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Bluesky   | Verified                                                        | Verified                                                          |
| Facebook  | Verified                                                        | Verified                                                          |
| Instagram | Verified                                                        | Verified                                                          |
| LinkedIn  | Verified                                                        | Verified                                                          |
| Pinterest | Verified                                                        | Verified                                                          |
| Telegram  | Verified                                                        | Verified                                                          |
| Threads   | Verified                                                        | Verified                                                          |
| TikTok    | Receipt accepted; platform view requires human slider challenge | Not submitted; lane paused                                        |
| X         | Not submitted; connection requires OAuth reconnection           | Not submitted; connection requires OAuth reconnection             |
| YouTube   | Outside this profile                                            | Uploaded privately; owner metadata verified, browser view blocked |

Fourteen cases have complete saved-post, publishing-record and platform-content
proof. Sixteen cases have publication receipts in total, including TikTok's
publish handle and YouTube's video ID. The remaining three cases have not been
submitted. The same journals and provider receipts were retained across resumes;
accepted posts were never replaced to retry their verification.

YouTube owner readback independently verified the exact channel, title,
description, private visibility, original 31,130,349-byte source, one 720×1280
stream, successful processing and processed duration `PT31S`. Google omitted
`fileDetails.durationMs`. The browser still requires its private-video notice;
Google redirected both the test browser and normal installed Chrome to an
unusual-traffic human check. Therefore the full YouTube case remains incomplete.

YouTube also reported failure to apply the generated custom thumbnail. The SDK
returned the existing video ID with a warning and did not upload another video.
The thumbnail capability is outside this upload profile; no thumbnail success is
claimed.

TikTok requires a human slider challenge before the platform content can be
observed. Its accepted publish handle alone is not final content proof. X reports
expired credentials that cannot be refreshed; it must be reconnected normally.

## Harness corrections and validation

Working with Claude Code CLI using `claude-fable-5-1`, we corrected:

- YouTube's already displayed Private selection needed an actual change and
  selection back to persist the explicit request option. The request guard
  caught the omission before submission, and was retained.
- Telegram changed its caption wrapper; caption matching still checks exact
  text, bot identity, incoming direction and submission time.
- Pinterest changed its closeup, description and image selectors. Checks remain
  confined to the actual pin, including author identity and media.
- TikTok's upload profile no longer requires a separate music-setting observer.
  Explicit music requests and music-specific regression checks remain intact;
  this profile verifies media and audience.
- YouTube may omit source duration despite supplying file details. Absent source
  duration is omitted from evidence. When supplied, it remains strictly checked.
  Processed duration, exact source bytes, dimensions, processing status, ownership,
  text and privacy remain required. The private browser notice is still required.
- Google's explicit unusual-traffic challenge URL is classified as a setup block.

The first live invocation had ten passes, three harness failures and two paused
cases. After the first corrections, the resumed invocation verified the four
Telegram/Pinterest cases and exposed the independent TikTok/YouTube browser
blocks. Pinterest video processing needed about two minutes before its content
could be verified. Neither invocation silently treated paused cases as passes.

Validation completed:

- Aggregate PR GitHub CI passed before the main merge.
- SDK: **916 tests passed** across 42 suites.
- Full offline E2E suite after the first harness fixes: **687 checks passed**,
  including all 19 upload scenario contracts with large originals present.
- The later YouTube metadata and challenge classification changes passed **46
  focused offline checks** and TypeScript/format checks.
- SDK/CLI builds passed before live execution.

These success-path live checks do not establish recovery after an actual provider
outage. Retry and ambiguous-outcome behavior have automated SDK coverage; no
provider outage was injected into production.

## Resume

Retain the ignored config, original files, existing run ID, journals and receipts.
Reconnect X and complete the platform human checks before continuing. Resume
accepted receipts for verification; submit only the three cases that have never
been sent. The configuration retains a 19-post total cap, two per platform (one
for YouTube), and a pause after the first failure per platform.

Authentication files, connection details and raw local artifacts remain ignored.
The saved app session was refreshed through normal manual sign-in and was checked
against the configured test user and all ten social identities before execution.
