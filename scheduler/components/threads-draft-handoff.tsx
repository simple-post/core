"use client";

import { useState } from "react";

import { ArrowUpRight, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { getThreadsDraftHandoffs } from "@/features/platform-options/threads-handoff";
import { getAccountDisplayName } from "@/lib/config";
import { useUiTranslation } from "@/lib/i18n/client";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { MediaFile } from "@/types";

export function ThreadsDraftHandoff({
  account,
  caption,
  media,
  draftPath,
  intentUrl,
  showAccount,
}: ReturnType<typeof getThreadsDraftHandoffs>[number] & { showAccount: boolean }) {
  const { copy } = useUiCopy();
  const { t } = useUiTranslation();
  const accountName = getAccountDisplayName(account);
  const [draftUrl, setDraftUrl] = useState("");
  const [downloading, setDownloading] = useState<number | null>(null);
  const [failedDownload, setFailedDownload] = useState<number | null>(null);

  async function download(file: MediaFile, index: number) {
    setDownloading(index);
    setFailedDownload(null);
    try {
      if (!/^https?:\/\//i.test(file.url)) throw new Error("Invalid media URL");
      const response = await fetch(file.url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Download failed");

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setFailedDownload(index);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) setDraftUrl(new URL(draftPath, window.location.origin).href);
      }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <ArrowUpRight aria-hidden="true" className="size-4" />
          {copy("Finish in Threads")}
          {showAccount ? ` · ${accountName}` : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy("Finish in Threads")}</DialogTitle>
          <DialogDescription>
            {copy(
              "Open the Threads mobile app as {{account}}. Attach any media below, then select Options → Mark as paid partnership before posting. Check for the label on the live post.",
              { account: accountName },
            )}
          </DialogDescription>
        </DialogHeader>

        {draftUrl && (
          <div className="hidden items-center gap-4 rounded-lg border border-border p-3 sm:flex">
            <QRCodeSVG aria-hidden="true" className="shrink-0 rounded-sm" size={104} marginSize={4} value={draftUrl} />
            <p className="text-sm text-muted-foreground">{copy("Scan to open this draft on your phone.")}</p>
          </div>
        )}

        {caption && (
          <Textarea
            aria-label={t("message")}
            readOnly
            value={caption}
            rows={3}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}

        {media.length > 0 && (
          <ul className="divide-y rounded-lg border border-border text-sm">
            {media.map((file, index) => (
              <li key={`${file.id}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-all">{file.filename}</span>
                {(failedDownload === index || file.type === "video") && /^https?:\/\//i.test(file.url) ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href={file.url} target="_blank" rel="noreferrer">
                      {copy("Open original")}
                    </a>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={downloading !== null}
                    aria-busy={downloading === index}
                    onClick={() => void download(file, index)}>
                    <Download aria-hidden="true" className="size-4" />
                    {copy("Download")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {caption && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(caption);
                  toast.success(t("copiedToClipboard"));
                } catch {
                  toast.info(copy("Select the caption to copy it manually."));
                }
              }}>
              {t("copyToClipboard")}
            </Button>
          )}
          <Button asChild>
            <a href={intentUrl} target="_blank" rel="noreferrer">
              {copy("Open Threads composer")}
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
