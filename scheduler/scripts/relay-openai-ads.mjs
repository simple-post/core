/* eslint-disable no-console -- Scheduled task prints only aggregate delivery counts. */
// Uses existing runtime credentials. Never publish posts or print tokens/event payloads.
const secret = process.env.SCHEDULED_POST_DISPATCH_SECRET;
if (secret) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${Number(process.env.PORT) || 3000}/api/internal/ads-measurement/dispatch`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.ok) {
      const result = await response.json();
      console.log(JSON.stringify({ sent: result.sent, failed: result.failed }));
      if (result.failed) process.exitCode = 1;
    } else {
      console.error(`Conversion relay HTTP ${response.status}`);
      process.exitCode = 1;
    }
  } catch {
    console.error("Conversion relay request failed");
    process.exitCode = 1;
  }
} else {
  console.error("Conversion relay is missing its dispatch credential");
  process.exitCode = 1;
}
