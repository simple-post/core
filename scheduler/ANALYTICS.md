# Analytics setup

The `simplepost.social` Plausible site combines the marketing website and hosted
`app.simplepost.social` app. Both use the existing `api.simplepost.social` proxy.
No API key or new environment variable is required. App tracking only loads in
hosted production; local, preview and self-hosted origins do not send app events.

## Questions and reports

| Question | Report |
| --- | --- |
| When do people arrive, and from where? | Visitors over time, Sources, Channels and Campaigns; filter hostname to simplepost.social for marketing-only traffic. |
| Which landing pages bring visitors? | Entry Pages. |
| Where do they go next? | Pages, Exit Pages, and CTA Click → destination. These are aggregate reports, not a complete chronological session replay. |
| Which button gets clicked? | CTA Click → label, section and plan; filter Page to compare equivalent pages. Total events count clicks; unique conversions count visitors. |
| Which sources lead to purchases? | Select Paid Subscription, then Sources or Campaigns to compare converters and conversion rates. |
| Who is using a subscription versus a trial? | Authenticated Visit → access_type, subscription_status and plan. `stripe` means Stripe subscription access, not proof of a new payment. |
| Which named accounts are paying? | Use authenticated billing records / Stripe, not Plausible. Plausible has no names, emails or user IDs. |

## Goals configured on 2026-09-22

| Goal | Meaning |
| --- | --- |
| Landing Page Viewed | Existing pageview at `/`. |
| Landing Scroll 50% | Native scroll-depth goal on `/`. |
| CTA Click | Click on a static landing-page link/button/FAQ summary, or an explicitly tagged CTA elsewhere. |
| App Click | A tracked marketing link to app.simplepost.social. |
| App Opened | First app opening per browser tab session. |
| Sign In Started | Google or valid-email sign-in attempt; not a completed signup. |
| Authenticated Visit | Verified signed-in user with a loaded billing status; once per browser tab session, auth session and access type. Includes existing users. |
| Checkout Started | App successfully obtained a new Stripe checkout URL. Existing-subscriber redirects do not count. |
| Checkout Cancelled | Visitor returned to the app's checkout cancellation URL; once per tab session. |
| Paid Subscription | Browser returned and the authenticated API verified ownership of a completed live subscription checkout with a positive settled payment, created within 24 hours. |

The older Purchase Click goal is preserved; it is not a purchase metric.
Properties enabled: `label`, `section`, `destination`, `plan`, `access_type`,
`subscription_status`, `method`.

## Funnel and attribution limits

The current Plausible plan locks visual funnels and revenue tracking behind
Business. No subscription upgrade was purchased. The goals above are usable now;
when upgraded, create these ordered funnels:

1. Landing Page Viewed → App Click → App Opened → Authenticated Visit.
2. Checkout Started → Paid Subscription.
3. Landing Page Viewed → App Click → Checkout Started → Paid Subscription (same-session purchases only).

Do not divide unrelated stage totals and call that a sequential funnel.
Plausible's same-session source attribution works across the root domain and its
subdomains when they use the same site. It does not stitch a user's first visit
to a payment seven days later or on another device. Never put internal UTMs on
app links: this can overwrite acquisition context. Tag external campaigns instead,
for example `?utm_source=x&utm_medium=social&utm_campaign=launch`.

Conversion events are browser analytics, not a billing ledger: ad blockers,
network errors, closing Stripe without returning, delayed settlement and clearing
browser storage can cause missing or repeated events. Checkout IDs only serve as
local deduplication keys and are never sent to Plausible. This event records the
checkout's initial positive payment, not renewals, MRR, refunds or lifetime value.

Larger follow-up: persist first-touch source/campaign on signup, add an idempotent
billing-webhook conversion ledger, and join those records in an internal paid-user
report. This is needed for dependable acquisition-to-paid reporting through the
seven-day trial. A separate account-level report can show names and actual billing
status without exposing identity to Plausible.

## Release and verification

The website and core changes must both be deployed before the complete journey
appears. The website uses the normal reviewed `release/prod` promotion process.
Goals configured in Plausible alone do not deploy code or backfill missing events.

After deployment, verify a real visitor's journey in browser Network and Plausible
Realtime: one pageview per navigation, CTA Click properties, app entry, sign-in,
checkout start and a real verified payment. Do not manufacture paid events in the
production dashboard. Refresh the confirmation page and confirm payment is not
counted twice. Test-card and zero-value checkouts intentionally do not count.

App analytics paths are normalized to `/app/...`, with IDs, arbitrary query
parameters and fragments removed. Only campaign query keys are retained. Form
values, draft content, account IDs, emails and Stripe IDs are not event properties.
See core's `scheduler/tests/lib/analytics` for payment validation, delivery,
deduplication, excluded hosts and URL privacy tests.

References:
- https://plausible.io/docs/subdomain-hostname-filter
- https://plausible.io/docs/funnel-analysis
- https://plausible.io/docs/custom-props/for-custom-events
