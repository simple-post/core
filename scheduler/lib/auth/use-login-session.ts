"use client";

import { useEffect, useState } from "react";

import { useSession } from "./auth-client";

/** A background session check must not unmount an in-progress login form. */
export function useLoginSession() {
  const session = useSession();
  const [hasCheckedSession, setHasCheckedSession] = useState(false);

  useEffect(() => {
    if (!session.isPending) setHasCheckedSession(true);
  }, [session.isPending]);

  return { ...session, isPending: session.isPending && !hasCheckedSession };
}
