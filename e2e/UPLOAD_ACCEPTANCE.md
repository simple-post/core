# Upload acceptance review

The owner approved production execution after merging and deploying the combined
branch. See [the current results](UPLOAD_ACCEPTANCE_RESULTS.md) for completed
offline checks, the deployed revision, and live outcomes. Seventeen cases have complete verification; the owner accepted TikTok with
its two remaining automated checks waived.

## Branch and scope

PRs #162 through #172 are merged into `codex/upload-acceptance`, including the
latest Chrome test fix. The aggregate was subsequently merged into `main` and
`release/prod` under the owner's approval. This branch combines all ten platform
implementations and the shared retry helper.

The dedicated `uploads` profile uses the existing posting runner, Edmund Clompton
account configuration, identity checks, budgets, journals, screenshots, and native
platform observers. It defaults to the browser UI only. It does not repeat the
same cases through MCP and CLI, and does not include carousels, scheduling,
metadata variations, or Forem.

| Platforms                                                                       | Cases per platform                                 | Maximum posts |
| ------------------------------------------------------------------------------- | -------------------------------------------------- | ------------- |
| X, Telegram, Instagram, Facebook, Threads, TikTok, Pinterest, LinkedIn, Bluesky | One image and one video                            | 18            |
| YouTube                                                                         | One private video, verified through owner readback | 1             |
| Total                                                                           |                                                    | 19            |

Each post carries a unique run/scenario marker. The run keeps every accepted post
ID and reuses existing receipts when resumed. A verification problem does not
permit a replacement upload. The prepared configuration pauses a platform after
its first failed case and caps that platform at two posts (one for YouTube).

## Larger fixtures

The local generator creates a valid 1080×1080 JPEG below the SDK's 2,000,000-byte
Bluesky limit and a 30-second 720×1280 H.264/AAC MP4 at approximately 8 Mbps. The
video is expected to be roughly 30 MB, below the SDK's 50 MiB Telegram limit.
The prepared files are 1,961,069 bytes (JPEG) and 31,130,349 bytes (MP4). Exact byte counts and SHA-256 hashes are written to an ignored upload manifest.
Large files remain local; the normal tiny fixtures are unchanged.

This checks ordinary upload, publication, and processing with substantial media.
The video crosses X's 1 MiB and TikTok's 10 MiB chunk boundaries. Other providers
use their own transfer/session rules. A happy path pass is not proof that recovery
was exercised.

## Deployment and accounts

The existing Edmund configuration contains hosted accounts, with no CLI-local
platform credentials. The UI, MCP and CLI-app routes execute the deployed SDK;
changing the local CLI path alone cannot exercise this feature branch.

An ignored review configuration is prepared at
`e2e/.local/uploads/config.local.json`. It preserves the existing test-account
identities and observer-session paths, points contract checks at this checkout,
and retains the existing run-history directory. After the owner's approval it was
pointed at production with the deployed revision recorded. The authenticated test
user and all ten social identities were checked before the live run. Credentials
and session files remain ignored.

Existing TikTok challenges, expired sessions, provider quotas, or unavailable
owner readback must remain reported as blocked/inconclusive; they are not passes.

## Review commands

From the repository root, these commands prepare files or print the plan only:

```sh
yarn e2e:upload-fixtures
yarn e2e:plan --profile uploads --config .local/uploads/config.local.json
```

The approved live command is:

```sh
yarn e2e:live --profile uploads --interface ui --config .local/uploads/config.local.json --headed --run-id uploads-acceptance-YYYYMMDD
```

Use the same run ID to resume or verify accepted receipts. The existing report
contains per-case timings, requested settings, post IDs, and platform evidence.
Acceptance requires the correct account and marker, the uploaded image's content,
and a processed/playable video. Private YouTube uses the framework's existing
owner API media proof and exact private-video-page visit.

## Recovery coverage

The combined branch retains the existing mocked regressions for retry exhaustion,
lost acknowledgments, same-session YouTube recovery, credential failures, and
secret redaction. The SDK suite passed all 916 tests before live execution.

A controlled YouTube lost-response experiment should be reviewed separately
before execution. It needs a way to discard one transfer acknowledgment within
the test deployment and observe the same session recovering, without adding a
production fault hook or creating another video. This experiment is not silently
included in the 19-post upload profile.
