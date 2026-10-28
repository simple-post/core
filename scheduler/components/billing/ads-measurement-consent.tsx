"use client";

export function AdsMeasurementConsent({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (process.env.NEXT_PUBLIC_OPENAI_ADS_MEASUREMENT_ENABLED !== "true") return null;
  return (
    <label className="my-4 flex items-start gap-3 text-sm text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <span>
        Help us measure our ads by sharing this purchase with OpenAI, including the plan, amount, currency and a hashed
        version of my billing email. Optional; you can subscribe without agreeing. This applies to the first payment
        only.{" "}
        <a href="/privacy#advertising-measurement" className="underline">
          Privacy details
        </a>
      </span>
    </label>
  );
}
