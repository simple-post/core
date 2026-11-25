import type { ReactNode } from "react";

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { auth } from "@/lib/auth/auth";
import { hasFeature } from "@/lib/features";

export default async function TeamWorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.id) return <LoginForm callbackURL="/workspaces" />;
  if (!(await hasFeature(session.user.id, "TEAM_WORKSPACES"))) notFound();
  return children;
}
