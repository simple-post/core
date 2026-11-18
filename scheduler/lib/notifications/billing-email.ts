import { escapeHtml } from "../resend/email-layout";

type BillingEmailInput = {
  appUrl: string;
  timeZone: string;
  effectiveAt: Date;
} & ({ kind: "trial_ending"; affectedPosts: number } | { kind: "paid_cancellation" });

type FounderEmail = { subject: string; html: string; text: string };
type Paragraph = string | { before: string; label: string; path: string; after: string };

export function formatFounderFrom(configuredFrom: string): string {
  const address = configuredFrom.match(/<([^<>]+)>\s*$/)?.[1] ?? configuredFrom;
  const domain = address.trim().match(/^[^@\s]+@([^@\s]+)$/)?.[1];
  if (!domain) throw new Error("Invalid Resend sender address");
  // Use the same verified Resend domain as the existing service mail.
  return `Vlad from SimplePost <vlad@${domain}>`;
}

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

export function renderBillingEmail(input: BillingEmailInput): FounderEmail {
  const end = formatDate(input.effectiveAt, input.timeZone);
  if (input.kind === "paid_cancellation") {
    return renderFounderEmail(input.appUrl, "Your SimplePost cancellation", [
      `I got your cancellation. Your paid access ends on ${end}.`,
      "If you have a minute, would you tell me why you canceled?",
    ]);
  }

  const paragraphs: Paragraph[] = [`Your SimplePost trial ends on ${end}. You won’t be charged automatically.`];
  if (input.affectedPosts > 0) {
    const warning =
      input.affectedPosts === 1
        ? "You have one post lined up for then or later. It needs active access to go out."
        : `You have ${input.affectedPosts} posts lined up for then or later. They need active access to go out.`;
    paragraphs.push({
      before: `${warning} You can `,
      label: "check your queue here",
      path: "/?tab=scheduled",
      after: ".",
    });
  }
  paragraphs.push("If you need more time or want a hand getting set up, reply and I’ll help.");
  return renderFounderEmail(input.appUrl, "Your SimplePost trial ends soon", paragraphs);
}

export function renderSetupReminderEmail(appUrl: string): FounderEmail {
  return renderFounderEmail(appUrl, "Your SimplePost setup reminder", [
    {
      before: "You asked me to send a reminder if you hadn’t connected a social account. When you’re ready, ",
      label: "connect an account",
      path: "/accounts?onboarding=connect",
      after: " and you can schedule your first post.",
    },
    "If you get stuck, reply and I’ll help.",
  ]);
}

function renderFounderEmail(appUrl: string, subject: string, paragraphs: Paragraph[]): FounderEmail {
  const logo = new URL("/simplepost-logo.png", appUrl);
  if (!["https:", "http:"].includes(logo.protocol)) throw new Error("Invalid email application URL");
  const lines: Paragraph[] = ["Hey, it’s Vlad, the founder of SimplePost.", ...paragraphs, "Vlad"];
  const body = lines
    .map((line) => {
      const content =
        typeof line === "string"
          ? escapeHtml(line)
          : `${escapeHtml(line.before)}<a href="${escapeHtml(new URL(line.path, appUrl).toString())}" style="color:#175cd3;text-decoration:underline">${escapeHtml(line.label)}</a>${escapeHtml(line.after)}`;
      return `<p style="margin:0 0 16px">${content}</p>`;
    })
    .join("\n");
  return {
    subject,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#fff;color:#222"><table role="presentation" width="100%" style="border-collapse:collapse"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:620px;border-collapse:collapse"><tr><td style="padding:24px 20px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
${body}
<img src="${escapeHtml(logo.toString())}" alt="SimplePost" width="28" height="28" style="display:block;width:28px;height:28px;border:0;border-radius:4px">
</td></tr></table></td></tr></table></body></html>`,
    text: lines
      .map((line) =>
        typeof line === "string"
          ? line
          : `${line.before}${line.label} (${new URL(line.path, appUrl).toString()})${line.after}`,
      )
      .join("\n\n"),
  };
}
