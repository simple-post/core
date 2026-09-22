# Analytics setup

The `simplepost.social` Plausible site combines the marketing website and hosted
`app.simplepost.social` app. Both use the existing `api.simplepost.social` proxy.
No Plausible API key is required. The internal report requires a database admin flag. App tracking only loads in
hosted production; local, preview and self-hosted origins do not send app events.

## Questions and reports

| Question                                    | Report                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When do people arrive, and from where?      | Visitors over time, Sources, Channels and Campaigns; filter hostname to simplepost.social for marketing-only traffic.                                                                                             |
| Which landing pages bring visitors?         | Entry Pages.                                                                                                                                                                                                      |
| Where do they go next?                      | Pages, Exit Pages, and CTA Click → destination. These are aggregate reports, not a complete chronological session replay.                                                                                         |
| Which button gets clicked?                  | CTA Click → label, section and plan; filter Page to compare equivalent pages. Total events count clicks; unique conversions count visitors.                                                                       |
| Which sources lead to purchases?            | `/admin/analytics` joins original source to confirmed first payment, including conversions after the seven-day trial. Plausible Paid Subscription shows browser-return conversions in its own attribution window. |
| Who is using a subscription versus a trial? | Authenticated Visit → access_type, subscription_status and plan. `stripe` means Stripe subscription access, not proof of a new payment.                                                                           |
| Which named accounts have paid?             | The restricted `/admin/analytics` report lists name, email, original source, signup/trial/payment dates and current subscription status. Plausible has no names, emails or user IDs.                              |

## Goals configured on 2026-09-22

| Goal                | Meaning                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing Page Viewed | Existing pageview at `/`.                                                                                                                                         |
| Landing Scroll 50%  | Native scroll-depth goal on `/`.                                                                                                                                  |
| CTA Click           | Click on a static landing-page link/button/FAQ summary, or an explicitly tagged CTA elsewhere.                                                                    |
| App Click           | A tracked marketing link to app.simplepost.social.                                                                                                                |
| App Opened          | First app opening per browser tab session.                                                                                                                        |
| Sign In Started     | Google or valid-email sign-in attempt; not a completed signup.                                                                                                    |
| Authenticated Visit | Verified signed-in user with a loaded billing status; once per browser tab session, auth session and access type. Includes existing users.                        |
| Checkout Started    | App successfully obtained a new Stripe checkout URL. Existing-subscriber redirects do not count.                                                                  |
| Checkout Cancelled  | Visitor returned to the app's checkout cancellation URL; once per tab session.                                                                                    |
| Paid Subscription   | Browser returned and the authenticated API verified ownership of a completed live subscription checkout with a positive settled payment, created within 24 hours. |

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

## Original visit → signup → trial → first payment

The website and hosted app share the versioned `sp_first_touch_v1` first-party
cookie on `simplepost.social`. It lasts up to 90 days and preserves the earliest
valid visit, including source, UTM medium/campaign/content/term, public landing
route and UTC time. Returning directly does not overwrite it. External campaign
UTMs take precedence over referrer hostname; no referrer means direct. Arbitrary
paths, URL queries, fragments and email-shaped UTM values are excluded. The
cookie has no generated visitor identifier. `plausible_ignore=true` is respected.

At account creation, Better Auth validates and copies that metadata into
`User.acquisition` in the same database write. This field is server-owned,
excluded from auth responses, and never changed by later sign-ins. Missing,
expired or invalid cookies produce an explicit unknown source. Existing users
remain untracked, so their renewals are not mistaken for first purchases.
Before signup, switching device/browser or clearing cookies can lose the source.
After signup, paying from another device still joins to the same account.

After a signed Stripe webhook synchronizes the canonical subscription, a live,
positive paid subscription invoice creates a `FirstPayment` row. Customer and
subscription IDs must match the account's subscription. Atomic PostgreSQL UPSERT
handles duplicates and concurrent delivery; an older invoice delivered later can
move the first-payment date earlier. Test-mode, unpaid, zero-value and unrelated
invoices are excluded. Webhook failures retain the existing retry behavior.
Account deletion cascades to the first-payment record.

The **internal report**, not a fabricated Plausible session, provides this
cross-day attribution. It is dynamically rendered and requires a verified account
whose `User.isAdmin` database column is true. The flag defaults to false for all
existing and new users. Access reads the current database value on every request,
so revoking the flag takes effect without signing out. The flag is not exposed as
an editable auth field. It is unavailable on self-hosted installations.
No named customer details are sent to Plausible.

Choose a signup cohort (UTC, inclusive dates, up to 366 days / 10,000 accounts).
Source/medium/campaign groups show signups, trials, first payers and running
unpaid trials. The mature trial conversion rate includes only trials whose full
window has ended, with payments through today, including later conversions.
The latest 100 first payers in the cohort show identity, original acquisition,
trial/payment dates and current subscription status. “Ever paid” is a historical
conversion, not current active subscriptions, MRR, net revenue or refund-adjusted
income. This does not backfill historical customers or infer sources for them.

The shared first-touch contract is copied in both repositories; keep it compatible
when changing cookie fields. This is basic first-touch attribution, not multi-touch
attribution, cross-device tracking before signup or session replay.

## Release and verification

The website and core changes must both be deployed before the complete journey
appears. Apply core's `20260922090000_acquisition_attribution` and `20260922100000_user_admin_flag` migrations before
starting the updated app and generate the Prisma client during the normal build.
Mark the owner's verified account as admin in the `user` table (set `isAdmin`
to true), then open `https://app.simplepost.social/admin/analytics`. Deploy the website
first (or together) to start collecting first-touch cookies. No live configuration,
production migration or deployment is performed by these PRs. The website uses the normal reviewed `release/prod` promotion process.
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

Validation includes attribution parsing and expiry, mature cohort calculations,
admin denial rules, and disposable PostgreSQL integration tests exercising all
migrations, concurrent duplicate/renewal/out-of-order invoices, invoice exclusions,
legacy-account exclusion, account deletion and UTC timestamps.

Run the database tests only against a disposable localhost `simplepost_review`
database, after `prisma migrate deploy`:

```sh
INTEGRATION_DATABASE_URL=postgresql://localhost:55439/simplepost_review jest --config jest.integration.config.cjs --runInBand integration/acquisition-attribution.test.ts
DATABASE_URL=postgresql://localhost:55439/simplepost_review BETTER_AUTH_SECRET=local-test-secret RESEND_API_KEY=local-test-key ENABLE_OPENAI_TEST_LOGIN=true tsx integration/auth-attribution.ts
```

The second test exercises the real Better Auth runtime: initial source capture,
unchanged attribution on repeat login, unknown fallback, and omission from auth
responses. It uses only the disposable database and sends no email.
