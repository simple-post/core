# OpenAI Ads paid-subscription reporting draft

This PR prepares server-side `subscription_created` reporting from confirmed
Stripe payments. It makes no changes to checkout, plan selection, checkout request
payloads, or the app privacy page. There is no new checkbox or consent prompt.

## Not ready to enable

Reporting is disabled by default. Removing a checkbox does not grant permission to
share customer data. The event builder still requires a versioned measurement
permission and timestamp in signed subscription metadata; this PR does not create
that metadata anywhere. Normal SimplePost checkouts therefore do not send events,
even if an operator supplies API credentials and enables the deployment flag.

Before this can be enabled, agree on a separate measurement-permission mechanism
and implement it with withdrawal handling and appropriate disclosure. Do not set
permission metadata globally or treat signup, accepting product terms, subscribing,
or the deployment flag as customer permission to share a purchase and hashed email.
Keep this PR in draft until that design is resolved and tested end to end.

The required external setup is also pending: the owner must review OpenAI's
Conversion Terms and create a SimplePost data source and the standard
`subscription_created` event in Ads Manager. A conversions campaign must select
that event from that source. The existing Clicks pilot remains a separate campaign.

## Server configuration

- `OPENAI_ADS_MEASUREMENT_ENABLED=true`: explicit server-only deployment switch.
- `OPENAI_ADS_PIXEL_ID`: Pixel ID identifying the conversion source.
- `OPENAI_CONVERSIONS_API_KEY`: server-only Conversions API credential, not a model
  API key. Store it in the secret manager, never in source control or a public env.

Delivery also requires production, the hosted application origin, and self-hosting
disabled. These configuration checks do not replace the per-event permission gate.
No credential provisioning, deployment, migration, or live validation is performed.

## Event selection and data

A signed Stripe invoice webhook synchronizes billing and records the first payment
before attempting measurement. The invoice must match the canonical customer and
subscription, be live and settled with positive value, and match the existing
`first_payment` ledger. Events seven days old or older are excluded. Trials, free
payments, renewals, test payments and unknown historical payment records are skipped.

When an approved permission source is implemented, eligible events contain the
payment time, plan, amount in minor units, currency, fixed billing page URL, stable
hashed customer event ID, and SHA-256 normalized billing email. The hash is still
customer matching data, not anonymous data. Raw email, names, IP, user agent, social
credentials and content are not sent. `opt_out: true` opts out of future user-level
personalization. There is no browser Pixel or `oppref`/`obref` collection, so matching
may undercount. Internal and Plausible analytics keep their existing behavior.

## Delivery and retries

Billing access is synchronized before measurement. A three-second timeout or
non-2xx response fails the webhook and uses Stripe's existing retry mechanism.
Both successful invoice event types, retries and late first-payment corrections
share one hashed customer-based CAPI ID for deduplication. An outage longer than
the seven-day event limit can lose measurement. Use failed-webhook monitoring;
never log credentials, matching hashes, request payloads or upstream response bodies.

After the permission mechanism and source are configured, validate a representative
payload using CAPI `validate_only: true`, then verify an eligible real payment under
the intended source before activating any conversion campaign.

Sources:

- [Conversions API](https://learn.chatgpt.com/ads/conversions-api)
- [Supported events](https://learn.chatgpt.com/ads/supported-events)
- [Conversion tracking setup](https://learn.chatgpt.com/ads/conversion-tracking)
