"use client"

import type React from "react"

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // Once OAuth credentials are configured, this will check for valid sessions
  return <>{children}</>
}
