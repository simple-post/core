# OpenAI Ads paid-subscription measurement

This optional, server-only integration reports `subscription_created` when a signed
Stripe invoice event matches the customer's canonical subscription and the existing
`first_payment` ledger. The invoice must be live, settled and positive value, with
an event timestamp less than seven days old. Trials, free invoices, checkout opens,
renewals, historical accounts without acquisition records and test payments
do not create acquisition conversions. Existing internal and Plausible analytics
keep their existing behavior.

## Enable after review

1. In Creafex Lab's Ads Manager **Conversions**, create a website data source and
   a standard **Paid Subscription** (`subscription_created`) conversion event.
   The campaign must select that event from that source. The account had no
   conversion event settings when inspected on October 28, 2026.
2. Generate a Conversions API credential for this source in Ads Manager. Store
   `OPENAI_CONVERSIONS_API_KEY` in the scheduler's server secret manager and set
   `OPENAI_ADS_PIXEL_ID` to the source's Pixel ID. This is not a model API key.
   Never use a `NEXT_PUBLIC_` name for the credential or commit the value.
3. Set `NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED=true` at build and runtime,
   then rebuild and deploy the scheduler. Delivery additionally requires production,
   the hosted application origin, both credentials, and `SELF_HOSTED` disabled.
4. Review the optional checkout checkbox and linked app privacy disclosure. It is
   unchecked on every new checkout page. No persisted blanket consent is created.
5. Validate a representative event with the CAPI `validate_only: true` mode in a
   controlled operator check, then inspect a real, consenting first payment in
   Ads Manager. Local tests mock delivery and do not send customer data.
6. Keep the campaign paused until the event appears under the intended source,
   geographic eligibility is checked, and spend is explicitly authorized.

The existing deployment is not changed by this PR. Disable the flag and rebuild
to remove the checkbox and stop delivery, including pending webhook retries.

## Consent, matching and limits

The customer explicitly opts in to sharing this purchase, its value and their
hashed billing email. Checkout writes a versioned consent statement and server
timestamp to its Stripe metadata and subscription metadata. The webhook requires
that signed metadata and consent predating payment. Missing consent fails closed.
Consent is per purchase, does not cover renewals, and can be changed before opening
Stripe or avoided by abandoning checkout. The app privacy page explains privacy
requests after transmission. No automatic or advanced matching from forms is used.

Only the normalized SHA-256 email, fixed billing page URL, stable hashed customer-based
event ID, event time, plan, amount and currency are sent. Raw email, names, IP,
user agent, site paths, auth/session tokens, acquisition cookies and content are
not sent. `opt_out: true` opts out of future user-level personalization.

This first implementation uses email matching only. It does not capture or forward
`oppref` or `obref`, install a browser Pixel, or add marketing cookies. Attribution
can therefore undercount where the billing email cannot be matched or the customer
does not consent. It does not establish end-to-end measurement readiness. A future
consent-managed browser integration can improve matching without changing the
business event. If added, use the same hashed customer-based event ID and Pixel ID to
deduplicate browser/server events.

## Delivery and retries

Billing synchronization and the first-payment ledger finish before sending to
OpenAI, so a measurement outage does not remove access already granted. Network
errors and non-2xx responses fail the webhook after a three-second timeout and
use its existing Stripe retry mechanism. Both successful invoice event types and
all retries use the same hashed customer-based CAPI ID. OpenAI deduplicates this key;
the existing Stripe event claim handles same-event replays. Events older than
seven days are skipped, so an extended outage can lose measurement.

Errors contain only a fixed message or HTTP status. Never log request bodies,
matching hashes, credentials or upstream response bodies. Use Stripe failed-webhook
monitoring to detect delivery failures; resolve invalid source/key configuration
before retrying. No historical backfill or deployment/migration is performed.

Sources:

- [Conversions API](https://learn.chatgpt.com/ads/conversions-api)
- [Supported events](https://learn.chatgpt.com/ads/supported-events)
- [Conversion tracking setup](https://learn.chatgpt.com/ads/conversion-tracking)
