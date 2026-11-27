"use client";

import Link from "next/link";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAccountDisplayName } from "@/lib/config";
import { useUiTranslation } from "@/lib/i18n/client";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { ConnectedAccount } from "@/types";

export function InstagramReconnectDialog({
  open,
  account,
  backHref,
  onBack,
  onDismiss,
  onRetry,
}: {
  open: boolean;
  account?: ConnectedAccount;
  backHref?: string;
  onBack: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const { copy } = useUiCopy();
  const { t } = useUiTranslation();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent
        className="max-h-[calc(100%-2rem)] gap-5 overflow-y-auto sm:max-w-md"
        showCloseButton={Boolean(backHref)}>
        <DialogHeader className="pe-5 text-start">
          <DialogTitle className="leading-snug">{copy("Different Instagram account selected")}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {copy("Switch to the Instagram account you originally connected to SimplePost, then try again.")}
          </DialogDescription>
        </DialogHeader>
        {account && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3.5 py-3">
            <div aria-hidden="true">
              <PlatformIconBadge platform="instagram" className="size-9 border-0" iconClassName="text-base" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{copy("Account to reconnect")}</p>
              <p className="text-sm font-medium wrap-anywhere" dir="auto">
                {getAccountDisplayName(account)}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          {backHref ? (
            <Button variant="outline" asChild>
              <Link href={backHref} onClick={onBack}>
                {copy("Go back")}
              </Link>
            </Button>
          ) : (
            <DialogClose asChild>
              <Button variant="outline">{t("close")}</Button>
            </DialogClose>
          )}
          {onRetry && <Button onClick={onRetry}>{copy("Try again")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
