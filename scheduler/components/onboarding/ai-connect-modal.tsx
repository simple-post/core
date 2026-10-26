"use client";

import { AssistantSelector } from "@/components/assistant-selector";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Only opened by an explicit install action. Setup details scroll without moving the dialog. */
export function AiConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[min(480px,90dvh)] flex-col gap-5 overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle>Install SimplePost in your AI</DialogTitle>
          <DialogDescription>Choose your assistant.</DialogDescription>
        </DialogHeader>
        <AssistantSelector onInstall={onClose} />
      </DialogContent>
    </Dialog>
  );
}
