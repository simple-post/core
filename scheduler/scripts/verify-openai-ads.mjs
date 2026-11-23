/* eslint-disable no-console -- This operator command prints redacted validation results. */
// Run inside the production web container. No events are stored and no secrets are printed.
const config = {
  enabled: process.env.OPENAI_ADS_MEASUREMENT_ENABLED === "true",
  pixelPresent: Boolean(process.env.OPENAI_ADS_PIXEL_ID),
  keyPresent: Boolean(process.env.OPENAI_CONVERSIONS_API_KEY),
  production: process.env.NODE_ENV === "production",
  correctOrigin: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") === "https://app.simplepost.social",
  hosted: process.env.SELF_HOSTED !== "true",
};
console.log(JSON.stringify({ configuration: config }));
if (Object.values(config).every(Boolean)) {
  const events = ["trial_started", "subscription_created", "social_account_connected", "first_post_published"].map(
    (kind) => {
      const custom = kind === "social_account_connected" || kind === "first_post_published";
      return {
        id: `simplepost_validation_${kind}`,
        type: custom ? "custom" : kind,
        ...(custom ? { custom_event_name: kind } : {}),
        timestamp_ms: Date.now(),
        action_source: "web",
        source_url: "https://app.simplepost.social/",
        opt_out: true,
        data: custom
          ? { type: "custom" }
          : {
              type: "plan_enrollment",
              plan_id: kind === "trial_started" ? "trial" : "basic",
              ...(kind === "subscription_created" ? { amount: 900, currency: "EUR" } : {}),
            },
      };
    },
  );
  try {
    const response = await fetch(
      `https://bzr.openai.com/v1/events?pid=${encodeURIComponent(process.env.OPENAI_ADS_PIXEL_ID)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_CONVERSIONS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ validate_only: true, integration_source: "simplepost", events }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    console.log(
      JSON.stringify({
        validationOnly: true,
        status: response.status,
        accepted: response.ok,
        eventCount: events.length,
      }),
    );
    await response.body?.cancel();
    if (!response.ok) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ validationOnly: true, accepted: false, error: "Conversion API request failed" }));
    process.exitCode = 1;
  }
} else {
  process.exitCode = 1;
}
