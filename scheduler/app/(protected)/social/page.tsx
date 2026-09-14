"use client";

import { Navbar } from "@/components/navbar";
import { SocialInbox } from "@/components/social-activity";

export default function SocialInboxPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <SocialInbox />
    </div>
  );
}
