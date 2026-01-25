"use client";

import type React from "react";

import { PostDraftProvider } from "@/components/post-draft-context";

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return <PostDraftProvider>{children}</PostDraftProvider>;
}
