# Homepage experiment measurement

Companion to the marketing website's `homepage_workflow_v1` hero-copy test and
`homepage_workflow_aa_v1` instrumentation check. Both repositories are required.
The website's `docs/homepage-experiment.md` contains copy, power examples and the full rollout checklist.

## Deploy and configure

1. Apply migrations using `yarn workspace @simple-post/scheduler exec prisma migrate deploy`
   in the normal deployment environment. This adds nullable user attribution,
   an exposure table, and an account-deletion trigger. Connection and publication
   outcomes reuse the existing activation milestone table and triggers. Use migrations, not `prisma db push`: the latter
   does not install the triggers. Generate Prisma client as part of the normal build.
2. Set `HOMEPAGE_EXPERIMENT_SECRET` to the same strong random secret (at least 32 characters)
   on the hosted scheduler and marketing server, through the existing secret manager.
   Set `EXPERIMENT_INGEST_ENABLED=true` on the scheduler. `SELF_HOSTED=true` always disables
   ingestion, signup attribution and the results page. The ingestion flag defaults off.
3. Set the website's `EXPERIMENT_INGEST_URL` to
   `https://app.simplepost.social/api/internal/experiments/exposure`. Deploy the website with
   enrollment off, then run A/A before A/B. The website controls mode and explicit UTC start/end.
   The request requires a bearer key and a valid purpose-specific signed assignment. No CORS
   exposure or app session is needed for this server-to-server endpoint.
4. Schedule `node scripts/prune-experiments.mjs --apply` daily from the `scheduler/` directory
   with the scheduler's normal `DATABASE_URL`, and alert on failures. This is an operator cron
   job, **not automatically scheduled by this PR**. It removes experiment attribution and exposures older than
   180 days, without deleting users, shared activation milestones, first-touch attribution or billing records. Configure it
   before enrollment to match the website privacy disclosure. For an export, aggregate results
   before pruning; do not retain raw assignment data indefinitely.
5. Open `/admin/experiments` as an existing verified analytics admin. It reuses the current
   database-backed admin gate. No roles or permissions are granted by this change.

Keep the secret after enrollment closes so already exposed visitors can still link their
signup. Setting the website mode to `off` restores control and stops new enrollment immediately
on the next request. It does not erase historical data or disable follow-up reporting.
Rotating the secret invalidates outstanding browser assignments; do not rotate mid-test.
Keep the additive schema when rolling back the website or app code.

## Data model and outcome definitions

- A browser's assignment is signed, independent from immutable first-touch attribution, and
  shared by cookie across the public site and app. Cookies expire after 120 days without
  sliding renewal. Only SHA-256 assignment keys enter the database, never the raw cookie.
- `experiment_exposure` records first server receipt after the client sees the hero. Native
  `INSERT ... ON CONFLICT DO NOTHING` (`createMany/skipDuplicates`) deduplicates concurrent
  requests. Empty Prisma upserts are deliberately avoided: their emulated read/insert can race.
- `user.experimentAttribution` is captured atomically by Better Auth's create-user hook.
  It is server-only, not accepted as profile input, not returned in auth responses, and not
  updated at later sign-in. There is no analytics query in the auth hook. A signup without
  a matching, earlier recorded exposure cannot count as an experimental conversion.
- The existing `activation_milestone` supplies `socialConnectedAt` and `firstPostPublishedAt`.
  Its PostgreSQL triggers cover UI, MCP, API and scheduled dispatch, retaining earliest
  timestamps. Failed/partial publishing does not count. Deleting a post or social connection
  does not erase the milestone. Experiment signups also receive the existing acquisition
  attribution, so the shared signup trigger creates their activation row atomically.
  Pruning experiment evidence leaves these shared acquisition outcomes intact.
- Account deletion cascades milestones and removes its linked exposure. Deleting one of
  multiple accounts sharing the same browser assignment removes that shared exposure too;
  this is a documented privacy tradeoff and a reason not to interpret browsers as people.
- First payment comes from the existing Stripe-confirmed `first_payment` row and must have
  `amountPaid > 0`. No additional webhook, Stripe secret or client payment event is required.

The date filters select **first-exposure dates in UTC**, not signup dates. A/B and A/A are
always reported separately. A browser can contribute at most one new signup:

| Metric           | Conversion condition                                                      | Denominator                    |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------ |
| Primary signup   | New account within 7 days after exposure                                  | Exposures at least 7 days old  |
| First connection | Eligible signup and first connection within 7 days after signup           | Exposures at least 14 days old |
| Activation       | Eligible signup and first fully published post within 7 days after signup | Exposures at least 14 days old |
| Paid             | Eligible signup and positive first payment within 30 days after exposure  | Exposures at least 30 days old |

Boundary timestamps are inclusive for outcomes. Enrollment end is exclusive. The report
shows pending windows, observed signups, descriptive 95% Wilson signup intervals, and a
50/50 sample-ratio mismatch warning (Pearson chi-square, 1 df, p < 0.001; minimum 20 exposures).
It does not declare a winner or support optional stopping. Predeclare baseline, sample size,
minimum worthwhile lift and decision date before enabling `ab`. An underpowered result is
inconclusive. Wait through all conversion windows after enrollment ends.

The aggregate-only report selects at most 10,001 exposures/accounts and refuses cohorts
above 10,000 instead of silently truncating. Missing/out-of-cohort exposure, duplicate account
and late signup counts are diagnostic; an account's original exposure may be outside the
selected range. Do not combine these with Plausible totals, whose visitor definition differs.
Cookie deletion, shared browsers, cross-device magic links, blocking, opt-outs and account
deletion constrain attribution. No missing evidence is reconstructed from unrelated totals.

## Verification

From `scheduler/`:

```sh
yarn test --runInBand
yarn check
```

The following integration test requires an isolated localhost PostgreSQL database named
`simplepost_review` with the migrations applied. The test aborts for any other database.
It uses actual Better Auth Google and magic-link handlers and local provider-transport
fixtures. It never contacts Google, sends mail or publishes externally. Test values below
are intentionally non-production and must never be used in deployments.

```sh
DATABASE_URL=postgresql://LOCAL_USER@127.0.0.1:55440/simplepost_review \
BETTER_AUTH_SECRET=local-review-better-auth-secret-at-least-32 \
SELF_HOSTED=false \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
GOOGLE_CLIENT_ID=local-review-google \
GOOGLE_CLIENT_SECRET=local-review-google-secret \
RESEND_API_KEY=re_local_review \
HOMEPAGE_EXPERIMENT_SECRET=local-review-experiment-secret-at-least-32 \
node --import ../e2e/node_modules/tsx/dist/loader.mjs integration/experiments.ts
```

It verifies signed attribution through both callback flows, existing-user exclusion,
immutable attribution after repeat login/profile edits, private auth responses, denied admin
self-promotion, concurrent exposure deduplication, first-milestone retention after deletion,
account-deletion cleanup, and retention pruning that preserves first-touch and billing records. Unit tests cover time windows, invalid signatures, sample-ratio
mismatch, disabled/self-hosted ingestion, missing authorization and failure responses.

The marketing repo tests origin enforcement, rendered-arm matching, streamed body limits,
opt-out cookies, assignment stability, signed expiry, request-header sanitization and cache
policy. Both copies of `lib/experiments/contract.ts` are a shared wire contract: update and
review them together when introducing a new experiment ID or version.
