import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth";
import { hasFeature } from "@/lib/features";
import { prisma } from "@/lib/prisma";

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ delivery?: string }> }) {
  const { delivery } = await searchParams;
  if (!delivery) redirect("/");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !(await hasFeature(session.user.id, "TEAM_WORKSPACES"))) notFound();
  const item = await prisma.teamPost.findFirst({
    where: {
      workspace: { members: { some: { userId: session.user.id } } },
      reviews: { some: { deliveries: { some: { id: delivery, userId: session.user.id } } } },
    },
    select: { id: true, workspaceId: true },
  });
  if (!item) notFound();
  redirect(`/posts/${item.id}?workspace=${encodeURIComponent(item.workspaceId)}`);
}
