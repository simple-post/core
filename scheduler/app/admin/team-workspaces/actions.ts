"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth";
import { hasVerifiedAdminAccess } from "@/lib/auth/verified-admin";
import { prisma } from "@/lib/prisma";

export async function updateWorkspaceGrant(form: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.id || !(await hasVerifiedAdminAccess(session.user.id))) notFound();

  const action = form.get("action");
  const feature = "TEAM_WORKSPACES" as const;
  const adminPath = "/admin/team-workspaces";
  if (action === "revoke") {
    const userId = form.get("userId");
    if (typeof userId !== "string" || !userId) notFound();
    await prisma.userFeature.deleteMany({ where: { userId, feature } });
  } else {
    let userId = session.user.id;
    if (action === "grantEmail") {
      const email = form.get("email");
      if (typeof email !== "string") notFound();
      const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true, emailVerified: true },
      });
      if (!user?.emailVerified) redirect(adminPath + "?result=missing");
      userId = user.id;
    } else if (action !== "grantSelf") notFound();
    await prisma.userFeature.upsert({
      where: { userId_feature: { userId, feature } },
      create: { userId, feature },
      update: {},
    });
  }
  revalidatePath(adminPath);
  revalidatePath("/workspaces", "layout");
  redirect(adminPath + (action === "revoke" ? "?result=revoked" : "?result=enabled"));
}
