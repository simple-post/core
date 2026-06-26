"use client";

import { useSearchParams } from "next/navigation";

import { PlanSelection } from "@/components/billing/plan-selection";
import { Navbar } from "@/components/navbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SubscribePage() {
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        {checkout === "cancelled" ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-border bg-card">
              <AlertTitle>Checkout canceled</AlertTitle>
              <AlertDescription>No subscription was created. Choose a plan when you are ready.</AlertDescription>
            </Alert>
          </div>
        ) : null}
        <PlanSelection />
      </main>
    </div>
  );
}
