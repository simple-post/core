"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"

export function UserMenu() {
  return (
    <Link href="/login">
      <Button variant="outline" className="rounded-xl bg-transparent">
        Sign In
      </Button>
    </Link>
  )
}
