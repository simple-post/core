# Funnel measurement rollout

This change adds observation to the existing marketing site, authentication, app, MCP tools and billing flows. Customer screens, text, prompts, permissions, prices, trial rules and publishing behavior do not change. External account settings and the proposals in the accompanying lists have not been applied.

## Sources of truth

| Question                                                    | Evidence                                                                                                                                      | Limits                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do visitors reach the app or an assistant listing?          | Plausible pageviews, CTA Click, App Click, Assistant Install Click                                                                            | Clicks are not installs. Anonymous visitors cannot be joined reliably to accounts across devices or assistant-native signup.                                            |
| Do they start or finish authentication?                     | Sign In Viewed/Started/Code Sent/Code Resent/Failed in the browser; server delivery/failure events; account creation and successful sessions  | Email sends and failures are attempts, not unique people. Existing account sign-in is separate from signup. Provider cancellation may never return to the app.          |
| Do accounts connect an assistant and actually use it?       | Existing first token milestone, first real tool call, first successful tool result; per-tool attempt/outcome events                           | Token issuance is not use. Client names are self-reported and are not acquisition evidence. Discovery and pings are excluded.                                           |
| Do they connect a social account?                           | Start/cancel/failure observations plus database-backed first connected-account insertion                                                      | Reconnects create operational observations; first milestone remains earliest. A multi-account selection still in progress is not a successful connection.               |
| Do they try to create, save, schedule and publish?          | API/MCP creation attempts and rejections; database post lifecycle ledger; earliest milestones; second UTC publishing day                      | Attempts include retries and editor commits. Database post success means the app's published state, not measured social reach.                                          |
| Do they reach checkout, pay, or encounter billing problems? | Plan observations, checkout created/failed/completed/expired; verified live invoice outcomes; existing earliest positive subscription payment | Checkout completion is not proof of positive cash. Renewals, failed attempts and subscription-end notifications are separate facts.                                     |
| Where are trials lost?                                      | Actual trial expiry plus a selectable grace window; social/publish status by expiry; payment by deadline                                      | Different trial lengths must not share a maturity assumption. Unpaid can include complimentary users; this is an account funnel, not a pure purchase-intent experiment. |

## Attribution contract

`sp_first_touch_v1` remains an immutable, shared, 90-day first-touch cookie. Old v1 cookies are valid. `sp_last_non_direct_v1` records a separate latest identifiable touch without replacing it on a direct return. Explicit UTMs take priority over public `ref`/`source` tags, followed by an external referrer. Query strings, fragments, private post paths and auth payloads are not retained. Cookie writes use the existing owned shared domain, Secure and SameSite=Lax, with no visitor ID.

Auth/payment-provider returns and known connection callbacks are excluded from latest-touch capture. An initial document's referrer is not reused during SPA navigation. Reporting normalizes source aliases (for example, chat.openai.com and chatgpt.com), while stored source evidence remains original.

At account creation, the server freezes first touch, identifiable last touch, signup entry (`web`, `assistant_authorize`, `cli_authorize`), measurement/signup/onboarding versions and the existing trial offer. Entry route is a path into signup, **not proof of referral from ChatGPT**. Current versions are release labels for observations made after this deployment; they do not retrospectively date the previous signup changes. Bump the appropriate constant with future relevant releases.

The signed-in browser synchronizes later identifiable touches separately through the milestone endpoint. First-payment processing freezes a snapshot; a later visit cannot overwrite an existing payment snapshot. Touches newer than a delayed payment are rejected, with the frozen signup touch used as a fallback. Older overwritten intervening touches and visits never observed in a browser are unavailable; the snapshot explicitly records this limitation.

"Direct" means no identifiable referral on that observed visit. It can represent bookmarks, copied links, email/chat/app referrer suppression, cookie loss, cross-device use, or genuinely typed traffic. "Unknown" means no valid stored first-touch evidence. Neither category is retroactively assigned to ChatGPT from subsequent tool use.

## Durable observations and privacy

`funnel_event` stores bounded technical labels and occurrence timestamps, linked internally to an account where available. It never stores post text, tool inputs/results, OTPs, credentials, emails, raw provider errors, arbitrary URLs or session tokens in event properties. Deduplication keys are hashed before storage. Anonymous email-delivery/failure observations have no visitor identifier. Account-linked events cascade on account deletion; post deletion preserves the lifecycle evidence. Account IDs and opaque delivery IDs are not sent to Plausible.

`analyticsExcluded` is a server-owned flag. Existing admins are marked during migration; current admins and excluded accounts are filtered from reports, account-linked event capture and activation relay. Anonymous attempts cannot be filtered by account identity. New demo/reviewer accounts are marked automatically. Existing demo accounts are excluded from report queries explicitly. Review additional internal accounts separately before interpreting totals.

Server observations are hosted-only and best effort. Database lifecycle triggers require acquisition tracking to avoid inventing historical first actions for legacy/self-hosted accounts. Explicit server operational observations may exist for older hosted accounts; the fixed milestone report shows missing coverage. Optional SQL capture warns with SQLSTATE, and application capture failures log `errorCode=funnel_capture_failed`. Neither intentionally fails the business action. The ledger begins at deployment; historical missing/deleted evidence is not fabricated. Repeat-day backfill from retained posts is a lower bound and is marked already reported.

## Reliable browser relay

Milestones use a two-minute lease, a protocol-v2 client and explicit acknowledgement. A claim no longer marks events delivered. A failed or abandoned claim becomes retryable; unknown, unreached, cross-user and superseded-lease receipts cannot mark delivery. Visible signed-in clients check on navigation, focus and a 60-second timer. Opaque local delivery keys suppress repeats after a lost acknowledgement. Plausible dropped responses do not acknowledge delivery when the proxy exposes the drop header. Browser opt-out is respected.

Delivery is best effort and may duplicate after a successful external send with a lost receipt on another browser. Users who never reopen the app may never relay their server milestones. Plausible timestamps are delivery time and must not be used for cross-day cohort conversion. The database occurrence timestamps and verified payment ledger are authoritative. Lease/attempt/error fields and report quality counters expose delivery gaps.

## Operator report

Existing verified analytics admins can GET:

```
/api/admin/analytics/funnel?from=2026-10-01&to=2026-10-28&window=7&grace=7&attribution=first
```

No new customer or operator screen is introduced. The response is private/no-store, contains aggregates only, and excludes admins/demo/excluded accounts. Dates select the inclusive UTC signup cohort; default is the last 90 days; maximum is 366 days and 10,000 accounts. Supported fixed windows: 1, 7, 14 or 30 days. Trial grace: 0, 7 or 14 days. Attribution is `first` or `last_non_direct` frozen **at signup**.

- Each row separates source/medium/campaign/content/landing page, entry point, release versions, trial offer and actual trial length. Fetch separate signup date ranges to compare weeks or releases.
- `eligible` includes only signups with the full fixed observation window; `immature` stays visible. Milestones/payments count only between signup and its deadline. These are parallel milestones, not a forced linear sequence; web users need not connect an assistant.
- `expiredTrialEligible` uses each actual trial expiry plus grace. `trialPaid` counts payment by that deadline. Remaining users are classified by their reached social/publish stage **at trial expiry**.
- `quality` reports direct/unknown/campaign/version/milestone coverage and relay pending/failed/leased accounts. Relay quality applies only to new `funnel-v2` accounts to avoid misleading historical alarms.
- `events` and `breakdown` are lifetime observed **attempts** for the selected signup cohort since rollout. Breakdown retains kind/channel/reason/platform/tool/client/plan, with an explicit truncation flag at 2,000 combinations. They are not the fixed-window unique-account counts. Anonymous authentication totals instead use event calendar dates and cannot serve as a joined signup denominator.

## Deployment and validation

Ship the additive app migration before the new app runtime; deploy the site contract alongside it. The first cookie name/schema stays compatible with the old releases. An old cached app client receives an empty milestone response and cannot lease events it cannot acknowledge. Rolling back application code leaves the additive data in place; do not drop collected evidence to undo a release. The old relay must not be used for long-term measurement after rollback because it marks delivery on claim.

Validate in staging with a tagged website → app → login journey, a direct return, assistant authorization, tool success/failure, social success/cancel, draft/schedule/publish, a later publishing day, failed checkout and signed test webhooks. Test-mode billing must not increase live paid-conversion counts. Verify database facts first, then browser receipt state and Plausible. Do not replay historical milestones as new external conversions.

Automated coverage includes identical attribution cases in both repositories, release/maturity and trial-length reporting, safe properties, real Better Auth hooks and server-owned field protection, durable post deletion, duplicate events/invoices, concurrent claims, lease recovery and internal exclusions. Local integration tests require the repository's disposable localhost `simplepost_review` guard. No production database migration or deployment is part of this PR.

See [external configuration proposals](external-configuration.md) and [UI/UX proposals](ui-ux-proposals.md) for the two separate approval lists.
