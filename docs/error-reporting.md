# Error reporting across Simple products

All five products use the same v1 incident format. Every unexpected application failure is reported to its product's private Telegram bot and SigNoz. The report starts with the error message and area, followed by user email/ID, country, client surface, agent, environment, time, request/tool/job identifiers and a unique report ID. Telegram leaves out unknown fields. SigNoz labels unknown context explicitly. Worker failures identify the worker, not an invented request location.

Telegram puts the product, urgency and error first, then groups the available context under bold labels. Its final line is a copyable report ID. SigNoz's log body retains the detailed plain text summary; structured attributes contain the complete sanitized stack and cause chain. Search `error.id` from the Telegram message to find the exact record. Existing traces/metrics continue; user IDs, emails and report IDs are never added as metric dimensions.

Example (illustrative):

```text
Simple Listen · ERROR · retrying
Error: Speech provider request timed out
Area: episode.speech
User: listener@example.com (user_123)
Country: unknown · Client: worker · Agent: unknown
Environment: production · Time: 2026-11-05T12:00:00.000Z
Job: episode_123
Attempt: 2
Report: <unique ID>
```

## Severity and coverage

- `fatal / immediate`: startup or process failure; investigate now.
- `error / investigate`: an operation failed; inspect the message, affected user, area and frequency.
- `error / retrying`: a failure with an explicitly scheduled recovery; each attempt is still reported.
- Expected input validation, expired authentication, permissions, quota and business-rule rejections retain their existing warning/info behavior. They are not unexpected application failures.

Central logger/error boundaries cover handled API failures, MCP tools (including errors returned inside HTTP 200), background jobs and Next.js request/render/action errors. Browser error listeners and error boundaries submit to a bounded same-origin endpoint. Email/ID are resolved by the server; browser-supplied identity is ignored. `x-simple-client: mobile|web|api|cli` is a diagnostic hint; MCP paths and known user agents also classify clients. Unknown agent names are not guessed. Trusted ingress must overwrite country/forwarded headers. Missing country stays unknown.

This repository handles its deployed application and backend surfaces. Native crashes inside separately maintained iOS/Android clients, infrastructure crashes before application code executes, and errors that are swallowed without reaching a reporting boundary require their own instrumentation; this does not install a mobile crash SDK or a host-level collector.

## Configuration and rollout

Each product uses its own Telegram bot for operator notifications, including error reports and any contact or review notifications. Use that product’s token across its web and worker services. The products may share the same private chat ID. Disable Telegram in development if those alerts should stay out of the production chat.

| Product              | Repository                | Default service      |
| -------------------- | ------------------------- | -------------------- |
| Simple Post          | simple-post/core          | simplepost-scheduler |
| Simple Muscle        | SimpleMuscle/server       | simplemuscle-server  |
| Simple Unmark        | SimpleUnmark/simpleunmark | simpleunmark         |
| Simple Listen        | CreafexLab/simplelisten   | simplelisten         |
| Simple Photo Gallery | SimplePhotoGallery/app    | simple-photo-gallery |

Runtime secrets (never committed):

```dotenv
LOG_TELEGRAM_BOT_TOKEN=<this product's bot token>
LOG_TELEGRAM_CHAT_ID=<private chat or group ID>
LOG_TELEGRAM_DISABLED=false
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://collector.example/v1/logs
OTEL_EXPORTER_OTLP_LOGS_HEADERS=signoz-ingestion-key=<if required>
OTEL_SERVICE_NAME=<service from the table>
OTEL_DEPLOYMENT_ENVIRONMENT=production
OTEL_SERVICE_VERSION=<commit SHA>
```

`OTEL_EXPORTER_OTLP_ENDPOINT` plus `/v1/logs` and `OTEL_EXPORTER_OTLP_HEADERS` are fallbacks. Logs-only endpoints work. Post/Muscle use their existing OpenTelemetry exporters; Listen/Unmark/Gallery use OTLP/HTTP JSON for incident logs (the collector must accept HTTP OTLP, not gRPC). Set `APP_ENV=production` for Listen. `OTEL_SDK_DISABLED` / `OTEL_LOGS_EXPORTER=none` disable SigNoz independently of Telegram. Missing bot credentials disable Telegram independently of SigNoz.

The old `LOG_TELEGRAM_MAX_PER_MINUTE` suppression does not apply to error reports. Each error starts delivery immediately to both destinations; repeated messages receive distinct IDs. Each HTTP delivery has a four-second deadline and one retry. Long Telegram rate-limit delays and exhausted retries produce a non-recursive `error_report_delivery_failed` warning with destination and report ID. The reporter never throws a delivery failure back into application work. This is bounded best-effort delivery, not a durable outbox: a process kill or prolonged destination outage can prevent delivery. Public browser ingestion has separate abuse/body limits (30 reports/minute/IP, 64 KiB), with explicit rejection instead of unbounded ingestion.

After merging and configuring credentials, send one synthetic report from each web/worker deployment, await `flushErrorReports()` (or Listen's `flushMonitoring()`), and verify both destinations by report ID. Confirm separate bot identities, readable summaries, full stack attributes, and correct production labels. Test an authenticated web/API/MCP operation to verify identity and proxy-derived country. These PRs do not deploy, create BotFather bots or change production secrets.

## Data handling and maintenance

Authenticated email is deliberately included for private operator triage. Credentials, authorization/cookie headers, signed URL query strings, bearer tokens and known secret path tokens are redacted. Request bodies, tool arguments, submitted articles, captions, media and other user content are excluded from context. Exception messages and stacks are diagnostic text; call sites must not embed private submitted content in exceptions. No retention settings are changed.

Keep the v1 reporting module and its contract tests synchronized across repos. New caught failures should pass the original Error, a stable area/tool name, and known identity/request/job fields. Do not replace the Error with a generic event name or truncated string. Scope request context with `withErrorContext`; never place a user's context in global variables. Extend the explicit context allowlist when adding diagnostic fields.

Validation: `npm run test:error-reporting` checks stack preservation, redaction, concurrent-user isolation, classification, independent sink failure, logs-only configuration and repeated-error delivery without real network calls. The PR workflow runs these contract tests without production secrets.

Reference: [SigNoz exception fields](https://signoz.io/docs/userguide/exceptions/) and [Next.js request-error instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).


## Browser alert priority

Backend error/fatal reports (HTTP 5xx, unexpected MCP failures and worker failures)
continue to send immediate Telegram alerts, including backend requests from web clients.
Browser ingress explicitly marks `error.source=browser`. Only reports from blocking
React/Next.js error boundaries have `browser.critical=true` and send Telegram alerts.
Resource failures, global browser errors, unhandled promises and recoverable hydration
errors remain in SigNoz with their original message, stack and context. They do not
send Telegram messages. The browser surface alone never suppresses a backend alert.
