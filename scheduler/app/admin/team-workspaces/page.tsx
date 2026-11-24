import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/auth/auth";
import { hasVerifiedAdminAccess } from "@/lib/auth/verified-admin";
import { prisma } from "@/lib/prisma";

import { updateWorkspaceGrant } from "./actions";

export default async function TeamWorkspaceAccess({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.id) return <LoginForm callbackURL="/admin/team-workspaces" />;
  if (!(await hasVerifiedAdminAccess(session.user.id))) notFound();
  const grants = await prisma.userFeature.findMany({
    where: { feature: "TEAM_WORKSPACES" },
    select: { user: { select: { id: true, email: true } } },
    orderBy: { user: { email: "asc" } },
  });
  const enabled = grants.some(({ user }) => user.id === session.user.id);
  const { result } = await searchParams;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Team workspace access</h1>
        <p className="text-sm text-muted-foreground">
          Only the accounts listed here can use team planning and approvals.
        </p>
      </header>
      {result === "missing" && (
        <p role="alert" className="text-sm text-destructive">
          No verified account matches that email.
        </p>
      )}
      {(result === "enabled" || result === "revoked") && (
        <p role="status" className="text-sm">
          {result === "enabled" ? "Account enabled." : "Access revoked."}
        </p>
      )}
      <Card className="items-start gap-4 px-6">
        <h2 className="font-semibold">Your account</h2>
        <p className="text-sm text-muted-foreground">{session.user.email}</p>
        {enabled ? (
          <Button asChild size="sm">
            <Link href="/workspaces" prefetch={false}>
              Open team workspaces
            </Link>
          </Button>
        ) : (
          <form action={updateWorkspaceGrant}>
            <Button size="sm" name="action" value="grantSelf">
              Enable for my account
            </Button>
          </form>
        )}
      </Card>
      <Card className="gap-4 px-6">
        <h2 className="font-semibold">Enabled accounts ({grants.length})</h2>
        {grants.map(({ user }) => (
          <form
            key={user.id}
            action={updateWorkspaceGrant}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <span className="break-all text-sm">{user.email}</span>
            <input type="hidden" name="userId" value={user.id} />
            <Button
              variant="outline"
              size="sm"
              name="action"
              value="revoke"
              aria-label={`Revoke access for ${user.email}`}>
              Revoke
            </Button>
          </form>
        ))}
        <form action={updateWorkspaceGrant} className="flex flex-wrap items-end gap-3">
          <Label className="flex-1 flex-col items-stretch">
            Account email
            <Input name="email" type="email" required />
          </Label>
          <Button size="sm" variant="outline" name="action" value="grantEmail">
            Enable account
          </Button>
        </form>
      </Card>
    </main>
  );
}
