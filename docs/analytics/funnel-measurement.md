# Funnel measurement

This change observes existing customer flows. No screens, copy, prompts, pricing, permissions, trial policy, publishing behavior or external account settings change.

## What answers each question

| Question                                            | Source of truth                                                                                                                       | Limits                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do visitors reach signup or an assistant listing?   | Existing Plausible pageviews, CTA Click and App Click; new Assistant Install Click                                                    | Existing click populations remain unchanged. Listing clicks are not installs; anonymous visitors cannot reliably be joined across devices.                                                                                 |
| Do they start or finish signup?                     | Existing/browser sign-in events and database account creation                                                                         | Email sends and sign-ins are not signups. Delivery/provider failures remain in operational logs.                                                                                                                           |
| Do they authorize an assistant and actually use it? | Existing token milestone; first observed real tool call/success for new signups; one completed tool_call observation with outcome     | Discovery/pings are excluded. An abruptly killed process before an outcome may be missed. A non-error result is tool success, not proof of a published post.                                                               |
| Do they connect a social account?                   | Existing first-connected-account milestone, new start/cancel/failure observations                                                     | Reconnect observations are attempts, not new people.                                                                                                                                                                       |
| Do they attempt, create, schedule or publish?       | First attempt plus existing durable creation/schedule/publish milestones; second UTC publishing day for new signups                   | Milestones survive post deletion. A post_failed observation counts failures across interfaces; detailed reasons remain in post diagnostics/logs.                                                                           |
| Do they see plans, attempt checkout and pay?        | Bounded plan observations; checkout creation/failure/completion/expiry; existing verified earliest positive live subscription payment | Checkout completion/totals are not cash. Renewal revenue remains in Stripe, separate from first conversion.                                                                                                                |
| Where are trials lost?                              | Actual expiry plus chosen grace window; social/publish milestones reached by expiry                                                   | Different trial lengths stay measurable separately. noTrial explicitly counts accounts without a trial row. Complimentary access may explain unpaid accounts; this is an account funnel, not a purchase-intent experiment. |

## Attribution

The existing immutable `sp_first_touch_v1` cookie remains compatible with old cookies. A separate shared `sp_last_non_direct_v1` cookie preserves a later identifiable campaign before signup, without replacing first touch or being overwritten by a direct return. Both retain the existing 90-day attribution window. Explicit UTMs precede bounded `ref`/`source` tags, then an external referrer. Cookies contain public routes and campaign metadata, with no visitor ID, private URL/query payload or post content.

Referrers are consumed only on the initial document, not reused on SPA navigation. Auth/payment-provider returns, connection callbacks and assistant/CLI authorization routes do not replace latest non-direct touch. First touch retains its historical semantics. Source aliases normalize together in the existing operator acquisition/landing reports; this can merge their displayed groups. The app writes a temporary signup-entry hint through login: web, assistant authorization or CLI authorization. Entry is not proof of discovery or featuring.

Account creation freezes first touch, last identifiable touch, entry, the existing trial offer and a single app-side `measurementVersion`. Signup date/release annotations distinguish product changes. Later visits do not rewrite acquisition. No payment-touch attribution subsystem is introduced.

Direct means no identifiable referral on the observed visit; unknown means no valid stored first touch. Neither is retroactively assigned to ChatGPT from later use. Referrer-only app landings through assistant authorization are labelled as authorization traffic in source breakdowns, separate from identified marketing visits. The authorization label depends on the entry hint surviving in the same browser; other-device/webview entry can remain ambiguous. The September featuring explanation remains unverified.

## Small durable observation ledger

`funnel_event` stores account-linked operational attempts: social/assistant authorization, completed MCP calls, API post attempts/rejections, plan observations, checkout outcomes, invoice failures, subscription cancellation/end and billing denials. Technical properties are bounded and allowlisted. Tool inputs/results, post text, emails, OTPs, credentials, raw errors and arbitrary URLs are not retained. Account deletion cascades; duplicate logical events use hashed keys.

A single SQL statement inserts an observation and updates any earliest tool/post-attempt milestone, with guards that avoid rewriting unchanged milestone rows. MCP observations use one row per completed invocation, with outcome/reason/duration and no per-call client lookup. Registration preserves schema-derived callback types and forwards existing schema forms unchanged. Each completed tool call awaits one extra database write; latency has not been benchmarked. Posting success/repeat milestones stay in the existing activation trigger; one new failure trigger covers posting failures. Signup, trial, social connection, post creation/scheduling and first payment are not duplicated into a second lifecycle ledger.

Capture is hosted-only and best effort. Optional application capture failures log `errorCode=funnel_capture_failed`; the post-failure trigger warns with SQLSTATE. Existing admins/new demo accounts are excluded automatically; report queries also filter the demo identity. Privately inventory other internal accounts before interpreting results.

## Prospective coverage and Plausible

Tool/attempt/repeat milestones are new observations for `funnel-v2` signup cohorts. The migration marks the new browser kinds reported for existing rows. Claims also filter by measurement version, covering accounts created between migration and runtime deployment. The report never counts those stages for unversioned cohorts; use `newStageEligible` as their denominator. Earlier history is unknown, not zero use. No historical repeat-use backfill or browser replay runs.

The pre-existing claim-once, navigation-triggered Plausible relay is retained. There is no polling timer, lease/ACK protocol or delivery queue. It may undercount if a claimed event is blocked or the browser closes, and events appear on browser delivery dates. **Database occurrence timestamps and verified first payment are authoritative for cohorts.** Server-only customers may never relay milestones. Browser analytics opt-out remains respected.

## Operator API

Verified analytics admins can GET:

```
/api/admin/analytics/funnel?from=2026-10-01&to=2026-10-28&window=7&grace=7&attribution=first&groupBy=source
```

This private/no-store endpoint returns aggregates, not account identity, and introduces no operator screen. Dates select an inclusive UTC signup cohort (default last 90 days; maximum 366 days and 10,000 accounts). Fixed windows: 1/7/14/30 days. Trial grace: 0/7/14 days. Attribution: first or last identifiable touch frozen at signup.

- `totals` provides the complete denominator, immature count, no-trial count and milestone/payment counts. Counts are parallel milestones; web users need not use an assistant.
- `rows` uses one grouping selector: source (also separating entry), campaign, entrypoint, landing_page, trial_days or signup_week. Query matched signup periods when comparing releases; don't mix signup-age windows with cumulative conversion.
- `eligible` requires the full fixed window. Tool/attempt/repeat counts additionally require v2 measurement coverage (`newStageEligible`). Existing milestones remain historical retained-data lower bounds.
- `expiredTrialEligible` requires actual expiry plus grace. `trialPaid` means payment by that deadline; the unpaid segments reflect social/publishing stage at expiry.
- `quality` exposes direct/unknown/tagged-source, version and missing-milestone coverage. `breakdown` contains lifetime observed attempts for this signup cohort, grouped by kind/channel/outcome/reason/platform/tool/plan, capped at 2,000 combinations with an explicit truncation flag. It is not a fixed-window unique-account denominator.

## Rollout

Apply the additive app migration before the new runtime; ship the compatible site contract alongside it. Neither PR runs a production migration or deploy. Rollback does not require dropping captured data. Test clean and populated-data migrations, historical version filtering, direct → campaign → signup handoff, authorization/referrer suppression, normal/error tool results, failed posts and repeat publishing after deletion, signed billing outcomes and admin access. Test-mode/zero-value invoices must not increase positive paid conversion.

See [external configuration proposals](external-configuration.md) and [UI/UX proposals](ui-ux-proposals.md), both review-only lists.
