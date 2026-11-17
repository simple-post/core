import { escapeHtml, renderEmailLayout } from "../resend/email-layout";

type BillingEmailInput = {
  appUrl: string;
  timeZone: string;
  effectiveAt: Date;
} & ({ kind: "trial_ending"; affectedPosts: number } | { kind: "paid_cancellation"; occurredAt: Date });

function formatDate(date: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(date);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(date);
  }
}

export function renderBillingEmail(input: BillingEmailInput): { subject: string; html: string; text: string } {
  const end = formatDate(input.effectiveAt, input.timeZone);
  const trial = input.kind === "trial_ending";
  const subject = trial ? "Your SimplePost trial ends soon" : "Your SimplePost cancellation is confirmed";
  const paragraphs = trial
    ? [
        `Your SimplePost trial ends on ${end}. You won’t be charged automatically.`,
        input.affectedPosts === 1
          ? "You have one post scheduled for then or later. It won’t publish without active posting access."
          : `You have ${input.affectedPosts} posts scheduled for then or later. They won’t publish without active posting access.`,
        "Need more time to try SimplePost, or stuck on something? Just reply and I’ll see what I can do.",
      ]
    : [
        `I received your cancellation on ${formatDate(input.occurredAt, input.timeZone)}. Your paid access ends on ${end}. Your subscription won’t renew.`,
        "Posts scheduled for that time or later need active posting access to go out. If you have a question about billing or your posts, just reply.",
      ];
  const action = trial ? "View scheduled posts" : "View billing";
  const url = new URL(trial ? "/?tab=scheduled" : "/billing", input.appUrl).toString();
  const signature = "Vlad\nFounder of SimplePost";
  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.65">${escapeHtml(value)}</p>`;
  const actionHtml = `<table role="presentation" style="border-collapse:collapse;margin:8px 0 24px"><tr><td bgcolor="#c6f432" style="border-radius:6px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background:#c6f432;border-radius:6px;color:#0a0a0a;text-decoration:none;font-weight:700">${escapeHtml(action)}</a></td></tr></table>`;
  return {
    subject,
    html: renderEmailLayout({
      appUrl: input.appUrl,
      title: subject,
      preheader: paragraphs[0],
      bodyHtml: `<h1 class="email-heading" style="margin:0 0 20px;font-size:28px;line-height:1.2">${escapeHtml(subject)}</h1>
${paragraph("Hey,")}
${paragraphs.map((line) => paragraph(line)).join("\n")}
${actionHtml}
<p style="margin:0;font-size:15px;line-height:1.6">Vlad<br>Founder of SimplePost</p>`,
    }),
    text: ["Hey,", ...paragraphs, `${action}: ${url}`, signature].join("\n\n"),
  };
}
