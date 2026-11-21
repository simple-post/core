# Account disconnect emails

The scheduled-post dispatcher runs the disconnect-notification sweep after publishing and credential refresh, even when no posts are due or dispatch throws. Keep the existing scheduled dispatch cron running; no new cron or email credentials are needed. Delivery uses `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` and `NEXT_PUBLIC_APP_URL`. Apply database migrations before deploying the code.

Notifications cover connected accounts with `credentialRefreshBlockedAt` set by the credential-health system: confirmed Instagram, Facebook or Threads revocation, permanent refresh rejection, and expired credentials that require reconnecting. Ordinary expiry warnings, transient outages, rate limits, and missing application configuration do not trigger disconnect emails. This feature does not poll every provider for undetected revocations. A newly revoked session is discovered on the next provider check. Already flagged accounts receive one notification after rollout.

Each account/disconnect timestamp has one durable outbox record. Repeated failures and concurrent dispatches share it. Reconnecting clears the account's blocked state; pending notices are cancelled on the next sweep. A later disconnect creates a new episode and can send a new email. Removing an account or user deletes its notifications through a cascading foreign key. The worker checks account state and the owner's email again immediately before sending; an email already submitted to the provider cannot be recalled by a concurrent reconnect.

The email identifies the account, links to Accounts, counts the owner's queued targets (excluding already published targets of partial-post retries), and explains that failed posts need rescheduling. HTML and plain-text versions are provided. The message and recipient are frozen before delivery, so retries use identical payloads and one provider idempotency key. The notification table and logs contain no OAuth credentials, raw provider errors, or post content. The frozen email does contain its recipient and public account label.

The HTML template uses the app's lime (`#c6f432`) and charcoal palette, its existing SP PNG logo, and Inter with standard email font fallbacks. The logo loads from `/simplepost-logo.png` on `NEXT_PUBLIC_APP_URL`, so that public asset must be reachable by email clients. The SimplePost name, instructions and reconnect button remain visible with remote images blocked. Desktop and mobile layouts use inline styles and presentation tables. Template changes apply to newly prepared messages; retries retain the frozen original to preserve provider idempotency.

The worker discovers up to 100 episodes and delivers up to 10 notices per dispatch, using at most three concurrent deliveries. Claims have a 90-second lease; crashed workers are recovered after it expires. Each provider request times out after 10 seconds. Failed delivery or persistence retries with exponential backoff, capped at one hour. Notification infrastructure errors do not fail publishing.

Resend retains idempotency keys for 24 hours: https://resend.com/docs/dashboard/emails/idempotency-keys. Automatic retries stop after 23 hours from the first prepared send to avoid duplicates after the key expires. Such records become `failed` and generate an operator error for review. A `sent` record means Resend accepted the email, not that it reached the recipient's inbox. Inbox delivery and bounces remain visible in Resend.

Read-only checks for operators:

```sql
SELECT status, count(*)
FROM account_disconnect_notification
GROUP BY status;

SELECT id, "accountId", attempts, "lastError", "firstAttemptAt", "nextAttemptAt"
FROM account_disconnect_notification
WHERE status = 'failed'
   OR (status = 'pending' AND "nextAttemptAt" < now() - interval '2 hours')
ORDER BY "createdAt" ASC;
```

For a failed or ambiguous send, check the provider's delivery record and the current account state before taking any manual delivery action. Do not reset an expired idempotency window blindly.
