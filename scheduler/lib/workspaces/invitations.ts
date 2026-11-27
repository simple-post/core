import { env } from "@/lib/env";
import { createLogger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { escapeHtml, renderEmailLayout } from "@/lib/resend/email-layout";
import { sendNotificationEmail } from "@/lib/resend/notification-email";

const log = createLogger("workspaces:invitations");

export async function deliverWorkspaceInvitation(inviteId: string) {
  try {
    const invite = await prisma.teamInvite.findUnique({
      where: { id: inviteId, expiresAt: { gt: new Date() } },
      select: { id: true, workspaceId: true, email: true, emailSentAt: true, workspace: { select: { name: true } } },
    });
    if (!invite) return false;
    if (invite.emailSentAt) return true;
    const url = new URL("/workspace-invitation", env.NEXT_PUBLIC_APP_URL);
    url.searchParams.set("team", invite.workspaceId);
    url.searchParams.set("invite", invite.id);
    const subject = `You're invited to ${invite.workspace.name.replaceAll(/[\r\n]+/g, " ")}`;
    const instructions = "Sign in with the email address that received this invitation. It expires after seven days.";
    await sendNotificationEmail(
      {
        from: env.RESEND_FROM_ADDRESS,
        to: invite.email,
        subject,
        text: `${subject}\n\n${instructions}\n\nAccept invitation: ${url.href}`,
        html: renderEmailLayout({
          appUrl: env.NEXT_PUBLIC_APP_URL,
          title: subject,
          preheader: subject,
          bodyHtml: `<h1 style="margin:0;font-size:25px">${escapeHtml(subject)}</h1>
<p style="line-height:1.6;color:#b7b7b7">${escapeHtml(instructions)}</p>
<a style="display:inline-block;padding:12px 18px;color:#111;background:#c6f432;border-radius:8px;text-decoration:none;font-weight:600" href="${escapeHtml(url.href)}">Accept invitation</a>`,
        }),
      },
      `workspace-invite/${invite.id}`,
    );
    await prisma.teamInvite.updateMany({ where: { id: invite.id }, data: { emailSentAt: new Date() } });
    return true;
  } catch (error) {
    log.warn({ err: serializeError(error) }, "Workspace invitation email failed");
    return false;
  }
}
