import type { ReactNode } from "react";
export function AccountCardView({
  avatar,
  name,
  platform,
  connectedAt,
  health,
  help,
  details,
  actions,
}: {
  avatar: ReactNode;
  name: string;
  platform: string;
  connectedAt?: string;
  health?: ReactNode;
  help?: ReactNode;
  details?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <article className="simplepost-visual rounded-2xl border border-border bg-card p-5 card-accent-hover">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0 w-full sm:w-auto sm:flex-1">
          {avatar}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="font-semibold text-base text-foreground truncate">{name}</h3>
              {health}
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <span>{platform}</span>
              {connectedAt ? (
                <>
                  <span className="text-[#555555]">·</span>
                  <span>Connected {connectedAt}</span>
                </>
              ) : null}
            </div>
            {help}
            {details}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">{actions}</div>
      </div>
    </article>
  );
}
export function AccountsHeading({ action }: { action: ReactNode }) {
  return (
    <div className="simplepost-visual mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="section-kicker !mb-0">
          <span className="section-kicker-dot" />
          <span className="section-kicker-label">Accounts</span>
        </div>
        <span className="h-3 w-px bg-border" />
        <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
          Connected <span className="text-primary">accounts</span>
        </h1>
      </div>
      {action}
    </div>
  );
}
export function ConnectAccountsEmpty({
  action,
  title = "No accounts connected",
  description = "Connect your first social media account to start scheduling and publishing posts.",
}: {
  action: ReactNode;
  title?: string;
  description?: string;
}) {
  return (
    <section className="simplepost-visual rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold mb-1.5">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">{description}</p>
      <div className="flex flex-wrap justify-center gap-2">{action}</div>
    </section>
  );
}
