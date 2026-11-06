"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { direction } from "@/lib/i18n/locales";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const { locale, copy } = useUiCopy();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      dir={direction(locale)}
      containerAriaLabel={copy("Notifications")}
      toastOptions={{ closeButtonAriaLabel: copy("Close toast"), ...toastOptions }}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
