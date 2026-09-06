# Live E2E status

Updated 2026-09-06 12:10 UTC. X is intentionally excluded. Application fixes belong to `core`; the live harness and local evidence belong to `core2`.

## Verified coverage

The current catalog has **497 supported scenario/interface combinations** across scheduler UI, MCP, and CLI-app, excluding X. **305 have verified evidence** for the configured test accounts. These are deduplicated results from saved runs across the observed deployments, not a claim that every case was rerun against the final commit. Unsupported combinations are excluded from the denominator; missing accounts, owner sessions, permissions, and provider limits remain incomplete. CLI-local is available in the harness but was not run because separate local provider credentials/aliases are not configured.

| Platform  |  UI | MCP | CLI-app | Verified / supported |
| --------- | --: | --: | ------: | -------------------: |
| telegram  |  27 |  34 |      29 |              90 / 90 |
| instagram |   9 |  11 |       9 |              29 / 29 |
| facebook  |   9 |  11 |       9 |              29 / 29 |
| threads   |  12 |  15 |      12 |              39 / 39 |
| pinterest |   8 |  11 |       9 |              28 / 28 |
| linkedin  |  10 |  12 |      10 |              32 / 35 |
| bluesky   |   8 |  12 |       9 |              29 / 35 |
| youtube   |   3 |  10 |       1 |              14 / 42 |
| tiktok    |   1 |   7 |       7 |             15 / 143 |
| forem     |   0 |   0 |       0 |               0 / 27 |

Telegram, Instagram, Facebook, Threads, and Pinterest have verified evidence for every supported case in these three interfaces. All 27 existing LinkedIn published-post receipts were reobserved with the corrected exact-author check; the additional UI PUBLIC case also passed. The remaining LinkedIn cases are CONNECTIONS visibility checks.

## Application fixes and release

| Main commit | Production merge | Change                                                                                                                                                                                                  |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6a3d329`   | `944d114`        | Facebook video captions; Instagram mixed carousel readiness; Pinterest multipart uploads/covers/board validation; Threads processing wait; TikTok empty description; YouTube owner readback; CLI errors |
| `79c76a6`   | `fdbd5ca`        | Complete ordered Threads image/video/mixed carousels up to 20 attachments                                                                                                                               |
| `4bcee4c`   | `59574e4`        | Pinterest processing wait up to five minutes; YouTube playlist OAuth scope and pre-publish validation                                                                                                   |
| `461b286`   | `dc548b7`        | YouTube owner source-file details and processing status                                                                                                                                                 |
| `ed4ef88`   | `e70c33c`        | Bluesky video eligibility/email/quota check before uploading                                                                                                                                            |
| `8deeac5`   | `261aa17`        | Conclusive YouTube upload-limit rejection stays a failed checkpoint instead of an unknown publishing outcome                                                                                            |
| `c992808`   | `7dcd335`        | Pass common/overridden media to advanced account options, restoring TikTok photo controls                                                                                                               |

All seven changes were committed and pushed to `main` and `release/prod`. Production behavior confirmed the YouTube readback routes, Threads mixed-media validation, expanded YouTube reconnect scope, and owner processing readback. On the final rollout, the advanced-page chunk changed to `page-223e49319367776e.js`; a normal Playwright upload showed the photo music, description, and cover controls. The saved TikTok UI cancellation regression then passed against production. The Coolify dashboard still requires login in the available Chrome session, so no exact deployed Git hash is claimed from its dashboard.

App checks passed: SDK 24 suites/422 tests, scheduler 72 suites/449 tests, CLI 12 suites/48 tests before the later focused patches; then Pinterest 6, post validation 14, CLI scope consumers 9, YouTube readback 7, Bluesky 53, YouTube publisher 24, and disposable-database publishing reliability 16. Relevant SDK builds, TypeScript, ESLint, formatting, and scheduler checks passed. The final one-line advanced-media fix passed the scheduler check and the live cancellation regression.

## Harness verification and recovery

The final full offline harness passed **410/410 tests**, TypeScript, and formatting. It targets the canonical application SDK inferred from the configured `/core/cli/bin/run.js`, rather than copying application code into `core2` or weakening contracts against its older SDK.

The harness now checks exact platform authors and receipts, carousel order and contents, video playback, and independently observable settings. Private YouTube uploads use owner-only source-file and processing evidence plus a visit to the exact private-video page; artifacts label this `private-view/ownerAPI` and `publicVisualProof: false`. LinkedIn PUBLIC uses a fresh unauthenticated browser and exact owner profile. CONNECTIONS never falls back to that public proof.

GET retries are limited to transient 502/503/504 responses. Composer retries happen only before submission. Mutations and uncertain submissions are not automatically replayed. Explicit default selections are exercised through real form changes. Verification-only mode reobserves saved published receipts. Recovery scans complete, bounded published history rather than only the latest 100 posts, rejects ambiguous matches and incomplete/changing pagination, and verifies saved options before accepting a receipt; account- and payload-aware aggregate history cannot borrow a pass from another account or retired scenario. Failed scheduled receipts now retain their observed failed status instead of being mislabeled as pending schedules.

Key completed runs:

- Telegram UI/MCP: `live-20260905225015733-c3e21e46` (61 supported cases); CLI-app: `live-20260906-telegram-cliapp-01` (29).
- Instagram: `live-20260906-instagram-ui` and `live-20260906-instagram-cli-app`; existing carousel and draft-edit receipts were reverified, not reposted. Mixed carousel MCP: `live-20260906093114220-a3cf4d7a`.
- Facebook: `live-20260906-facebook-ui` and `live-20260906-facebook-cli-app`; captioned video MCP was reverified in `live-20260906093230702-510ce13f`.
- Threads MCP carousels: `live-20260906100811302-fe869632`. Direct replies passed in `live-20260906115456183-7d4d0852` and `live-20260906115528894-682194fc`. The reply probe checks the immediate predecessor in the actual conversation, excluding recommendations and rejecting an ancestor mistaken for the direct parent. The older interrupted `threads.text` attempt in `live-20260906015653114-3fbdee96` was recovered from paginated scheduler history and platform-verified with its existing receipt `cmtp5vy7d00c3mx3d0c2o36h6`; no replacement post was submitted.
- Pinterest videos: `live-20260906101558831-23eceeb9`; UI/CLI-app completion: `live-20260906112425863-69189471` (17 supported cases).
- YouTube private upload: `live-20260906111647588-6d6b28ec`, existing video `lC-XguAoSLo`, reverified through the normal runner.
- TikTok UI cancel: `live-20260906-tiktok-ui-cancel-25`, receipt `cmtpreulf000bqa3d2x91lkcu`, cleanup `discarded`, no platform result and no TikTok publication.

## Remaining account and provider blockers

- **TikTok: 128 cases remain.** A saved owner Playwright session is needed to calibrate and verify privacy, music, interaction, and inbox settings. The account is private; approval to make it public is still pending. Creator info currently excludes PUBLIC and disables Duet/Stitch. Inbox cases may need owner/mobile observation if the relevant UI is unavailable on the web. No account-wide visibility setting was changed.
- **YouTube: 28 cases remain.** New uploads stopped when YouTube returned HTTP 400 `uploadLimitExceeded`; the channel allowance must recover before the remaining positive cases can run. Playlist cases additionally require the broader reconnect consent, still pending at Google's unverified-app warning. A dedicated unlisted test playlist was created and discovered: `PLeD-eN5w7UMM`. No broader OAuth grant was approved automatically.
- **Bluesky: 6 video cases remain.** The authenticated video service returned `unconfirmed_email`; the regular OAuth connection is valid. Verify the test account email in Bluesky settings. Replacing the SimplePost connection is not required for that prerequisite.
- **LinkedIn: 3 CONNECTIONS cases remain.** Save an owner Playwright session so the audience can be observed independently.
- **Forem: 27 cases remain.** No Forem/DEV test account is connected.

The user has been sent owner-session commands from the `core2` repository root:

```sh
yarn e2e:auth https://www.tiktok.com/@edmundclompton .local/auth/tiktok.json
yarn e2e:auth https://www.linkedin.com/feed/ .local/auth/linkedin.json
```

Run them one at a time, sign in normally, and resume Playwright Inspector to save each session. The saved sessions are discovered automatically.

## Evidence and resumption

Private journals, screenshots, reports, fixtures hosted by the app, and authentication state remain ignored by Git under `e2e/.local/` and `e2e/config.local.json`. Run evidence lives in `e2e/.local/runs/<run-id>/`; the aggregate is `e2e/.local/runs/aggregate.json`. Open the latest report with `yarn e2e:report`, or select one with `--run-id`.

Reuse the run ID to verify an existing receipt. Do not start a replacement upload for an uncertain outcome. Known YouTube quota failures and earlier provider failures retain their evidence; they are not counted as passes. Failed schedule records have been read back and are no longer pending dispatch. External test posts remain available for review; only run-owned cancellation targets were deleted.
