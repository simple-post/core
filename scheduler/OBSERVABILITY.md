# OpenTelemetry and SigNoz

The Scheduler app is instrumented with vendor-neutral OpenTelemetry. It exports server traces, application metrics, and correlated Pino logs over OTLP/HTTP. Telemetry is disabled by default and has no network activity until an OTLP endpoint is configured.

## SigNoz Cloud

Add these runtime variables to the Scheduler service in Coolify, replacing the region and key with the values from SigNoz:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.eu.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=YOUR_INGESTION_KEY
OTEL_SERVICE_NAME=simplepost-scheduler
OTEL_SERVICE_VERSION=YOUR_IMAGE_TAG_OR_GIT_SHA
OTEL_DEPLOYMENT_ENVIRONMENT=production
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

Use the base endpoint without `/v1/traces`; the OTLP exporters append the path for each signal. Set `OTEL_SERVICE_VERSION` to a new value for every deployment so SigNoz can identify releases.

For self-hosted SigNoz, point `OTEL_EXPORTER_OTLP_ENDPOINT` at its OpenTelemetry Collector, commonly `http://otel-collector:4318`, and omit the ingestion-key header unless your Collector requires authentication.

## Exported signals

Automatic server instrumentation provides Next.js request spans, outgoing HTTP/`fetch` spans, W3C trace-context propagation, exception status, and framework attributes. Custom spans cover:

- `simplepost.publish`: an immediate or scheduled multi-account publish
- `simplepost.publish.account`: one target platform within a publish
- `simplepost.repost`: a multi-account repost
- `simplepost.scheduler.dispatch`: one scheduled-dispatch run

The custom attributes intentionally contain only bounded operational dimensions such as platform, operation, outcome, counts, and media presence. Post text, account IDs, user IDs, credentials, provider payloads, and post URLs are not attached to spans or metrics.

The following custom metrics are exported:

| Metric                                   | Type      | Purpose                                                               |
| ---------------------------------------- | --------- | --------------------------------------------------------------------- |
| `simplepost.posting.targets`             | Counter   | Publishing results by operation, platform, and outcome                |
| `simplepost.posting.batches`             | Counter   | Publishing batches by operation and outcome, including fatal failures |
| `simplepost.posting.batch.duration`      | Histogram | End-to-end post/repost duration                                       |
| `simplepost.scheduler.dispatch.runs`     | Counter   | Dispatch runs by outcome                                              |
| `simplepost.scheduler.dispatch.duration` | Histogram | Dispatch-run duration                                                 |
| `simplepost.scheduler.posts`             | Counter   | Scheduled posts/reposts by outcome                                    |
| `simplepost.scheduler.stale_recovered`   | Counter   | Interrupted publishes recovered by the scheduler                      |
| `simplepost.scheduler.queue.lag`         | Histogram | Age of the oldest due post/repost at dispatch time                    |
| `simplepost.credentials.refresh`         | Counter   | Background credential-refresh results                                 |

Pino logs continue to be written as JSON to stdout and are also sent through the OpenTelemetry Logs SDK. Logs emitted inside a span include `trace_id`, `span_id`, and `trace_flags`, enabling direct trace/log correlation in SigNoz. Existing application redaction remains active before log export.

If your Collector already tails Docker stdout, set `OTEL_LOGS_EXPORTER=none` to prevent duplicate ingestion. Trace IDs remain in stdout logs while tracing is active.

## Optional controls

```dotenv
# Export all traces during initial verification
OTEL_TRACES_SAMPLER=always_on

# Faster metrics during initial verification (milliseconds)
OTEL_METRIC_EXPORT_INTERVAL=15000

# OpenTelemetry SDK diagnostics on the console. Defaults to error so failed
# exports are visible; raise to debug for troubleshooting or set none to mute.
OTEL_LOG_LEVEL=debug

# Disable one or all signals
OTEL_LOGS_EXPORTER=none
OTEL_METRICS_EXPORTER=none
OTEL_TRACES_EXPORTER=none
OTEL_SDK_DISABLED=true
```

Per-signal endpoint variables are supported when the signals go to different Collectors. Unlike the base endpoint, each one must include its full signal path:

```dotenv
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://collector.example/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://collector.example/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://collector.example/v1/logs
```

## Initial SigNoz setup

After deployment, generate a test API request and one test publish. Confirm that:

1. `simplepost-scheduler` appears under Services.
2. A request trace contains a `simplepost.publish` span and a child `simplepost.publish.account` span.
3. Logs filtered by `service.name = simplepost-scheduler` contain trace IDs.
4. The custom metrics above appear after the export interval.

Recommended first alerts:

- HTTP 5xx rate above 2% for five minutes
- p95 `simplepost.posting.batch.duration` above the expected publishing window
- `simplepost.posting.targets` failure ratio above 5%
- Any increase in `simplepost.scheduler.stale_recovered`
- Any increase in failed `simplepost.credentials.refresh`
- No `simplepost.scheduler.dispatch.runs` datapoints for longer than twice the cron interval
